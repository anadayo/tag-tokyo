-- Count CROSS records by insertion time. crossed_at is intentionally rounded
-- to the minute and can otherwise appear earlier than the session start.

create or replace function public.finish_tag_session()
returns table(
  session_id uuid,duration_seconds integer,distance_m double precision,walk_exp integer,
  cross_count integer,spot_count integer,areas text[]
) language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_session public.tag_sessions%rowtype;
begin
  v_user:=public.current_app_user_id();
  select * into v_session from public.tag_sessions
    where user_id=v_user and status='active' order by started_at desc limit 1 for update;
  if v_session.id is null then raise exception 'TAG session is not active';end if;
  update public.tag_sessions set status='stopped',ended_at=now() where id=v_session.id;
  return query select
    v_session.id,
    greatest(0,extract(epoch from(least(now(),v_session.expires_at)-v_session.started_at))::integer),
    v_session.valid_distance_m,
    v_session.walk_exp_earned,
    (select count(*)::integer from public.crossings c
      where v_user in(c.user_a,c.user_b) and c.created_at between v_session.started_at and now()),
    (select count(*)::integer from public.tag_spot_draws d
      where d.user_id=v_user and d.created_at between v_session.started_at and now()),
    coalesce((select array_agg(distinct c.area_label) from public.crossings c
      where v_user in(c.user_a,c.user_b) and c.created_at between v_session.started_at and now()),array[]::text[]);
end $$;

revoke all on function public.finish_tag_session() from public,anon;
grant execute on function public.finish_tag_session() to authenticated;
