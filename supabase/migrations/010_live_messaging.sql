-- Server-authoritative messaging for verified mutual matches.

create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);

create or replace function public.live_community_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.live_community_is_enabled() $$;

create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text
)
returns table(id bigint, match_id uuid, sender_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid;
  v_other uuid;
  v_body text;
begin
  v_sender := public.current_app_user_id();
  perform public.assert_live_member(v_sender);

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'message must be between 1 and 1000 characters';
  end if;

  select case when m.user_a = v_sender then m.user_b else m.user_a end
    into v_other
  from public.matches m
  where m.id = p_match_id and v_sender in (m.user_a, m.user_b);

  if v_other is null then raise exception 'mutual match required'; end if;
  perform public.assert_live_member(v_other);

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id, b.blocked_id) in ((v_sender, v_other), (v_other, v_sender))
  ) then raise exception 'message unavailable'; end if;

  if exists (
    select 1 from public.messages m
    where m.sender_id = v_sender and m.match_id = p_match_id
      and m.body = v_body and m.created_at > now() - interval '10 seconds'
  ) then raise exception 'duplicate message'; end if;

  if (
    select count(*) from public.messages m
    where m.sender_id = v_sender and m.created_at > now() - interval '1 minute'
  ) >= 12 then raise exception 'message rate limit exceeded'; end if;

  return query
  insert into public.messages (match_id, sender_id, body)
  values (p_match_id, v_sender, v_body)
  returning messages.id, messages.match_id, messages.sender_id, messages.body, messages.created_at;
end $$;

create or replace function public.send_crossing_tag(p_crossing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid;
  v_other uuid;
begin
  v_sender := public.current_app_user_id();
  perform public.assert_live_member(v_sender);

  select case when c.user_a = v_sender then c.user_b else c.user_a end
    into v_other
  from public.crossings c
  where c.id = p_crossing_id and c.expires_at > now() and v_sender in (c.user_a, c.user_b);

  if v_other is null then raise exception 'active crossing required'; end if;
  perform public.assert_live_member(v_other);
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id, b.blocked_id) in ((v_sender, v_other), (v_other, v_sender))
  ) then raise exception 'TAG unavailable'; end if;

  insert into public.likes (sender_id, receiver_id, crossing_id)
  values (v_sender, v_other, p_crossing_id)
  on conflict do nothing;

  return exists (
    select 1 from public.matches m
    where m.crossing_id = p_crossing_id and v_sender in (m.user_a, m.user_b)
  );
end $$;

create or replace function public.block_match_member(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_other uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'authenticated user required'; end if;

  select case when m.user_a = v_actor then m.user_b else m.user_a end
    into v_other
  from public.matches m
  where m.id = p_match_id and v_actor in (m.user_a, m.user_b);

  if v_other is null then raise exception 'match not found'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_actor, v_other)
  on conflict do nothing;
end $$;

create or replace function public.report_match_member(
  p_match_id uuid,
  p_reason text,
  p_detail text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_other uuid;
  v_report_id bigint;
  v_reason text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'authenticated user required'; end if;

  v_reason := trim(coalesce(p_reason, ''));
  if v_reason not in ('harassment', 'impersonation', 'solicitation', 'unsafe', 'other') then
    raise exception 'invalid report reason';
  end if;

  select case when m.user_a = v_actor then m.user_b else m.user_a end
    into v_other
  from public.matches m
  where m.id = p_match_id and v_actor in (m.user_a, m.user_b);

  if v_other is null then raise exception 'match not found'; end if;
  if exists (
    select 1 from public.reports r
    where r.reporter_id = v_actor and r.reported_id = v_other
      and r.created_at > now() - interval '24 hours'
  ) then raise exception 'report already submitted'; end if;

  insert into public.reports (reporter_id, reported_id, reason, detail)
  values (v_actor, v_other, v_reason, left(trim(coalesce(p_detail, '')), 1000))
  returning reports.id into v_report_id;
  return v_report_id;
end $$;

revoke insert on public.messages from authenticated;
revoke insert on public.likes from authenticated;
revoke all on function public.live_community_status() from public;
revoke all on function public.send_crossing_tag(uuid) from public, anon;
revoke all on function public.send_match_message(uuid, text) from public, anon;
revoke all on function public.block_match_member(uuid) from public, anon;
revoke all on function public.report_match_member(uuid, text, text) from public, anon;
grant execute on function public.send_match_message(uuid, text) to authenticated;
grant execute on function public.send_crossing_tag(uuid) to authenticated;
grant execute on function public.block_match_member(uuid) to authenticated;
grant execute on function public.report_match_member(uuid, text, text) to authenticated;
grant execute on function public.live_community_status() to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
