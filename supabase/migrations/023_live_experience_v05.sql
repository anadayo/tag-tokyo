-- TAG TOKYO v0.5: resumable TAG ON, active matches, read receipts and reactions.
-- This migration only extends live data; no existing rows are removed.

alter table public.messages
  add column if not exists read_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reaction text not null check (reaction in ('heart','smile','thanks')),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

alter table public.message_reactions enable row level security;
drop policy if exists message_reactions_participant_read on public.message_reactions;
create policy message_reactions_participant_read on public.message_reactions for select using (
  exists(select 1 from public.messages msg join public.matches m on m.id=msg.match_id
    where msg.id=message_id and public.current_app_user_id() in(m.user_a,m.user_b))
);

create or replace function public.touch_member_activity()
returns void language sql security definer set search_path=public as $$
  update public.users set last_seen_at=now() where id=public.current_app_user_id()
$$;

create or replace function public.get_active_tag_session()
returns table(session_id uuid,started_at timestamptz,expires_at timestamptz,duration_minutes integer,
  valid_distance_m double precision,walk_exp_earned integer)
language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  v_user:=public.current_app_user_id();
  update public.tag_sessions set status='expired',ended_at=coalesce(ended_at,now())
    where user_id=v_user and status='active' and expires_at<=now();
  return query select s.id,s.started_at,s.expires_at,
    greatest(1,round(extract(epoch from(s.expires_at-s.started_at))/60)::integer),
    coalesce(s.valid_distance_m,0),coalesce(s.walk_exp_earned,0)
    from public.tag_sessions s where s.user_id=v_user and s.status='active' and s.expires_at>now()
    order by s.started_at desc limit 1;
end $$;

create or replace function public.mark_match_read(p_match_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_count integer;
begin
  v_user:=public.current_app_user_id();
  if not exists(select 1 from public.matches where id=p_match_id and ended_at is null and v_user in(user_a,user_b)) then
    raise exception 'active match required';
  end if;
  update public.messages set read_at=coalesce(read_at,now())
    where match_id=p_match_id and sender_id<>v_user and read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.react_to_message(p_message_id bigint,p_reaction text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  v_user:=public.current_app_user_id();
  if p_reaction not in ('heart','smile','thanks') then raise exception 'invalid reaction';end if;
  if not exists(select 1 from public.messages msg join public.matches m on m.id=msg.match_id
    where msg.id=p_message_id and m.ended_at is null and v_user in(m.user_a,m.user_b)) then raise exception 'active match required';end if;
  insert into public.message_reactions(message_id,user_id,reaction) values(p_message_id,v_user,p_reaction)
    on conflict(message_id,user_id) do update set reaction=excluded.reaction,created_at=now();
end $$;

create or replace function public.unmatch_member(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  v_user:=public.current_app_user_id();
  update public.matches set ended_at=now(),ended_by=v_user
    where id=p_match_id and ended_at is null and v_user in(user_a,user_b);
  if not found then raise exception 'active match not found';end if;
end $$;

drop function if exists public.get_visible_member_profiles(uuid[]);
create function public.get_visible_member_profiles(p_user_ids uuid[])
returns table(user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text)
language sql stable security definer set search_path=public as $$
  select p.user_id,p.display_name,p.handle,p.bio,p.avatar_url,u.role='owner',
    coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]),
    coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]),
    (select count(*)::integer from public.user_tags mine join public.user_tags theirs on theirs.tag_id=mine.tag_id where mine.user_id=public.current_app_user_id() and theirs.user_id=u.id),
    case when u.last_seen_at>now()-interval '3 days' then 'recent' when u.last_seen_at>now()-interval '30 days' then 'away' else 'inactive' end
  from public.profiles p join public.users u on u.id=p.user_id
  where p.user_id=any(coalesce(p_user_ids,array[]::uuid[])) and u.status='active' and not u.is_demo
    and (p.user_id=public.current_app_user_id()
      or exists(select 1 from public.crossings c where c.expires_at>now() and public.current_app_user_id() in(c.user_a,c.user_b) and p.user_id in(c.user_a,c.user_b))
      or exists(select 1 from public.matches m where m.ended_at is null and public.current_app_user_id() in(m.user_a,m.user_b) and p.user_id in(m.user_a,m.user_b)))
$$;

drop function if exists public.send_match_message(uuid,text);
create function public.send_match_message(p_match_id uuid,p_body text)
returns table(id bigint,match_id uuid,sender_id uuid,body text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_sender uuid;v_other uuid;v_body text;
begin
  v_sender:=public.current_app_user_id();perform public.assert_live_member(v_sender);
  v_body:=trim(coalesce(p_body,''));
  if char_length(v_body) not between 1 and 1000 then raise exception 'message must be between 1 and 1000 characters';end if;
  select case when m.user_a=v_sender then m.user_b else m.user_a end into v_other from public.matches m
    where m.id=p_match_id and m.ended_at is null and v_sender in(m.user_a,m.user_b);
  if v_other is null then raise exception 'active mutual match required';end if;
  perform public.assert_live_member(v_other);
  if exists(select 1 from public.blocks b where (b.blocker_id,b.blocked_id) in((v_sender,v_other),(v_other,v_sender))) then raise exception 'message unavailable';end if;
  if exists(select 1 from public.messages m where m.sender_id=v_sender and m.match_id=p_match_id and m.body=v_body and m.created_at>now()-interval '10 seconds') then raise exception 'duplicate message';end if;
  if (select count(*) from public.messages m where m.sender_id=v_sender and m.created_at>now()-interval '1 minute')>=12 then raise exception 'message rate limit exceeded';end if;
  return query insert into public.messages(match_id,sender_id,body) values(p_match_id,v_sender,v_body)
    returning messages.id,messages.match_id,messages.sender_id,messages.body,messages.created_at,messages.read_at;
end $$;

drop policy if exists messages_match_insert on public.messages;
create policy messages_match_insert on public.messages for insert with check (
  sender_id=public.current_app_user_id()
  and exists(select 1 from public.matches m where m.id=match_id and m.ended_at is null and sender_id in(m.user_a,m.user_b))
  and not exists(select 1 from public.blocks b join public.matches m on m.id=match_id where (b.blocker_id,b.blocked_id) in((m.user_a,m.user_b),(m.user_b,m.user_a)))
);

create or replace function public.detect_crossings_private(p_radius_meters integer default 500,p_overlap_minutes integer default 3)
returns integer language plpgsql security definer set search_path=public as $$
declare created_count integer;
begin
  with candidate_pairs as (
    select least(sa.user_id,sb.user_id) user_a,greatest(sa.user_id,sb.user_id) user_b,
      greatest(sa.started_at,sb.started_at) crossed_at,
      case when(la.latitude+lb.latitude)/2<35.64 then '東京南部エリア'
        when(la.longitude+lb.longitude)/2<139.65 then '東京西部エリア'
        when(la.longitude+lb.longitude)/2>139.82 then '東京東部エリア' else '東京中央エリア' end area_label
    from public.tag_sessions sa join public.location_samples la on la.session_id=sa.id
    join public.tag_sessions sb on sb.id>sa.id and sb.status='active'
      and least(sa.expires_at,sb.expires_at)>=greatest(sa.started_at,sb.started_at)+make_interval(mins=>p_overlap_minutes)
    join public.location_samples lb on lb.session_id=sb.id
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and 6371000*2*asin(sqrt(power(sin(radians(lb.latitude-la.latitude)/2),2)+cos(radians(la.latitude))*cos(radians(lb.latitude))*power(sin(radians(lb.longitude-la.longitude)/2),2)))<=p_radius_meters
      and (select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as (
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('hour',crossed_at) from candidate_pairs
      on conflict do nothing returning 1
  ) select count(*) into created_count from inserted;
  return created_count;
end $$;

create index if not exists matches_active_participants_idx on public.matches(user_a,user_b) where ended_at is null;
create index if not exists messages_match_unread_idx on public.messages(match_id,read_at,created_at);

revoke all on public.message_reactions from anon,authenticated;
revoke all on function public.touch_member_activity() from public,anon;
revoke all on function public.get_active_tag_session() from public,anon;
revoke all on function public.mark_match_read(uuid) from public,anon;
revoke all on function public.react_to_message(bigint,text) from public,anon;
revoke all on function public.unmatch_member(uuid) from public,anon;
revoke all on function public.get_visible_member_profiles(uuid[]) from public,anon;
revoke all on function public.detect_crossings_private(integer,integer) from public,anon,authenticated;
grant select on public.message_reactions to authenticated;
grant execute on function public.touch_member_activity() to authenticated;
grant execute on function public.get_active_tag_session() to authenticated;
grant execute on function public.mark_match_read(uuid) to authenticated;
grant execute on function public.react_to_message(bigint,text) to authenticated;
grant execute on function public.unmatch_member(uuid) to authenticated;
grant execute on function public.get_visible_member_profiles(uuid[]) to authenticated;
