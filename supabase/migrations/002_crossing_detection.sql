create or replace function public.detect_crossings_private(p_radius_meters integer default 500, p_overlap_minutes integer default 3)
returns integer language plpgsql security definer set search_path = public as $$
declare created_count integer;
begin
  with candidate_pairs as (
    select
      least(sa.user_id, sb.user_id) user_a,
      greatest(sa.user_id, sb.user_id) user_b,
      greatest(sa.started_at, sb.started_at) crossed_at,
      case
        when (la.latitude + lb.latitude) / 2 < 35.64 then '東京南部エリア'
        when (la.longitude + lb.longitude) / 2 < 139.65 then '東京西部エリア'
        when (la.longitude + lb.longitude) / 2 > 139.82 then '東京東部エリア'
        else '東京中央エリア'
      end area_label
    from public.tag_sessions sa
    join public.location_samples la on la.session_id = sa.id
    join public.tag_sessions sb on sb.id > sa.id and sb.status = 'active'
      and least(sa.expires_at, sb.expires_at) >= greatest(sa.started_at, sb.started_at) + make_interval(mins => p_overlap_minutes)
    join public.location_samples lb on lb.session_id = sb.id
    where sa.status = 'active'
      and sa.expires_at > now() and sb.expires_at > now()
      and 6371000 * 2 * asin(sqrt(
        power(sin(radians(lb.latitude - la.latitude) / 2), 2)
        + cos(radians(la.latitude)) * cos(radians(lb.latitude))
        * power(sin(radians(lb.longitude - la.longitude) / 2), 2)
      )) <= p_radius_meters
      and not exists (select 1 from public.blocks b where (b.blocker_id,b.blocked_id) in ((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
  ), inserted as (
    insert into public.crossings (user_a, user_b, area_label, crossed_at)
    select distinct user_a, user_b, area_label, date_trunc('hour', crossed_at) from candidate_pairs
    on conflict do nothing returning 1
  ) select count(*) into created_count from inserted;
  return created_count;
end $$;

revoke all on function public.detect_crossings_private(integer,integer) from public, anon, authenticated;
