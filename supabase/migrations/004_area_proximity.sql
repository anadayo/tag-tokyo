-- Upgrade path for projects that already applied v0.3 before the 1km area rule.
alter table public.areas add column if not exists latitude double precision;
alter table public.areas add column if not exists longitude double precision;
alter table public.areas add column if not exists contribution_radius_m integer not null default 1000;

update public.areas set
  latitude = case id
    when 'kichijoji' then 35.7033 when 'shinjuku' then 35.6938 when 'shibuya' then 35.6580
    when 'ikebukuro' then 35.7295 when 'ueno' then 35.7141 when 'kitasenju' then 35.7497 else latitude end,
  longitude = case id
    when 'kichijoji' then 139.5796 when 'shinjuku' then 139.7034 when 'shibuya' then 139.7016
    when 'ikebukuro' then 139.7109 when 'ueno' then 139.7774 when 'kitasenju' then 139.8050 else longitude end,
  contribution_radius_m = 1000;

alter table public.areas alter column latitude set not null;
alter table public.areas alter column longitude set not null;

drop function if exists public.contribute_area_exp(text,integer);

create or replace function public.contribute_area_exp(
  p_area_id text, p_amount integer, p_latitude double precision, p_longitude double precision
)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_points bigint; v_area public.areas%rowtype; v_distance double precision;
begin
  v_user := public.current_app_user_id();
  if v_user is null or p_amount < 100 or p_amount > 1000 or p_amount % 100 <> 0 then raise exception 'invalid contribution'; end if;
  if not exists (select 1 from public.users where id=v_user and age_verified and birth_date <= current_date - interval '20 years' and not is_demo) then raise exception '20+ verified user required'; end if;
  select * into v_area from public.areas where id=p_area_id and active;
  if v_area.id is null then raise exception 'area unavailable'; end if;
  v_distance := 6371000 * 2 * asin(sqrt(
    power(sin(radians(v_area.latitude-p_latitude)/2),2)
    + cos(radians(p_latitude))*cos(radians(v_area.latitude))*power(sin(radians(v_area.longitude-p_longitude)/2),2)
  ));
  if v_distance > v_area.contribution_radius_m then raise exception 'EXP can be contributed only within 1km of the area base'; end if;
  perform public.spend_exp(v_user,p_amount,'area_contribution','area',p_area_id);
  insert into public.area_contributions (area_id,user_id,points) values (p_area_id,v_user,p_amount)
    on conflict (area_id,user_id) do update set points=area_contributions.points+excluded.points, updated_at=now()
    returning points into v_points;
  return v_points;
end $$;

grant execute on function public.contribute_area_exp(text,integer,double precision,double precision) to authenticated;
