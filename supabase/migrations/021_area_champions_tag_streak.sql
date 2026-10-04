-- TAG TOKYO v0.4 follow-up: real AREA CHAMPION data and non-punitive TAG streaks.

create or replace function public.get_area_champions()
returns table(
  area_id text,
  area_name text,
  champion_user_id uuid,
  champion_display_name text,
  champion_handle text,
  champion_points bigint,
  champion_is_official boolean,
  my_points bigint,
  points_to_first bigint
) language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.name,
    champion.user_id,
    champion.display_name,
    champion.handle,
    coalesce(champion.points,0),
    coalesce(champion.is_official,false),
    coalesce(mine.points,0),
    case
      when champion.user_id is null or champion.user_id=public.current_app_user_id() then 0
      else greatest(0,champion.points-coalesce(mine.points,0)+1)
    end
  from public.areas a
  left join lateral (
    select ac.user_id,p.display_name,p.handle,ac.points,(u.role='owner') as is_official
    from public.area_contributions ac
    join public.users u on u.id=ac.user_id
    join public.profiles p on p.user_id=ac.user_id
    where ac.area_id=a.id
      and u.status='active' and not u.is_demo and u.age_verified
      and u.age_verification_status='verified'
      and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
    order by ac.points desc,ac.updated_at asc
    limit 1
  ) champion on true
  left join public.area_contributions mine
    on mine.area_id=a.id and mine.user_id=public.current_app_user_id()
  where a.active
  order by a.name
$$;

create or replace function public.get_my_tag_streak()
returns table(current_streak integer,total_tag_days integer,last_tag_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_anchor date;
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);
  if exists (
    select 1 from public.tag_sessions s
    where s.user_id=v_user and (s.started_at at time zone 'Asia/Tokyo')::date=v_today
  ) then v_anchor := v_today;
  else v_anchor := v_today-1;
  end if;

  return query
  with recursive tag_dates as (
    select distinct (s.started_at at time zone 'Asia/Tokyo')::date as tag_date
    from public.tag_sessions s where s.user_id=v_user
  ), streak(day,days) as (
    select v_anchor,0
    union all
    select streak.day-1,streak.days+1
    from streak
    where streak.days<3650 and exists (select 1 from tag_dates d where d.tag_date=streak.day)
  )
  select
    coalesce((select max(streak.days)::integer from streak),0),
    (select count(*)::integer from tag_dates),
    (select max(tag_date) from tag_dates);
end $$;

revoke all on function public.get_area_champions() from public;
revoke all on function public.get_my_tag_streak() from public,anon;
grant execute on function public.get_area_champions() to anon,authenticated;
grant execute on function public.get_my_tag_streak() to authenticated;
