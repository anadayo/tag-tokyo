-- TAG TOKYO v0.4: server-authoritative walking EXP and session results.

alter table public.tag_sessions
  add column if not exists ended_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists valid_distance_m double precision not null default 0,
  add column if not exists walk_exp_earned integer not null default 0;

alter table public.location_samples
  add column if not exists accuracy_m double precision,
  add column if not exists captured_at timestamptz not null default now();

create index if not exists location_samples_session_captured_idx
  on public.location_samples (session_id, captured_at desc);

create table if not exists public.daily_movement (
  user_id uuid not null references public.users(id) on delete cascade,
  movement_date date not null,
  valid_distance_m double precision not null default 0 check (valid_distance_m >= 0),
  earned_exp integer not null default 0 check (earned_exp between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, movement_date)
);

alter table public.daily_movement enable row level security;
drop policy if exists daily_movement_self_read on public.daily_movement;
create policy daily_movement_self_read on public.daily_movement for select
  using (user_id = public.current_app_user_id());

alter table public.exp_ledger drop constraint if exists exp_ledger_reason_check;
alter table public.exp_ledger add constraint exp_ledger_reason_check check (reason in (
  'crossing','tag_spot','walk','mission','event','achievement',
  'area_contribution','cosmetic_exchange','admin_adjustment'
));

create or replace function public.issue_exp(
  p_user uuid, p_amount integer, p_reason text, p_reference_type text default null, p_reference_id text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_amount <= 0 or p_reason not in ('crossing','tag_spot','walk','mission','event','achievement','admin_adjustment') then
    raise exception 'invalid EXP award';
  end if;
  update public.profiles set
    total_earned_exp = total_earned_exp + p_amount,
    available_exp = available_exp + p_amount,
    profile_level = public.profile_level_for_exp(total_earned_exp + p_amount),
    updated_at = now()
  where user_id = p_user returning available_exp into v_balance;
  if v_balance is null then raise exception 'profile not found'; end if;
  insert into public.exp_ledger (user_id,amount,reason,reference_type,reference_id,balance_after)
    values (p_user,p_amount,p_reason,p_reference_type,p_reference_id,v_balance);
  return v_balance;
end $$;

create or replace function public.start_tag_session(
  p_latitude double precision,
  p_longitude double precision,
  p_duration_minutes integer,
  p_delete_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_session uuid;
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);
  if p_duration_minutes not in (30, 60, 180) then raise exception 'invalid duration'; end if;
  if p_latitude < 35.49 or p_latitude > 35.90 or p_longitude < 138.94 or p_longitude > 139.93 then
    raise exception 'TAG ON is available only in Tokyo';
  end if;
  update public.tag_sessions set status = 'stopped', ended_at = now()
    where user_id = v_user and status = 'active';
  insert into public.tag_sessions (user_id, expires_at, duration_minutes)
    values (v_user, now() + make_interval(mins => p_duration_minutes), p_duration_minutes)
    returning id into v_session;
  insert into public.location_samples (session_id, latitude, longitude, captured_at, delete_at)
    values (v_session, p_latitude, p_longitude, now(), least(p_delete_at, now() + interval '24 hours'));
  return v_session;
end $$;

create or replace function public.update_tag_location(
  p_session_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_captured_at timestamptz,
  p_delete_at timestamptz
) returns table(
  accepted_distance_m double precision,
  awarded_exp integer,
  session_distance_m double precision,
  session_walk_exp integer,
  daily_distance_m double precision,
  daily_walk_exp integer,
  daily_cap integer,
  sample_status text
) language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_session public.tag_sessions%rowtype;
  v_last public.location_samples%rowtype;
  v_distance double precision := 0;
  v_elapsed_seconds double precision := 0;
  v_speed_kmh double precision := 0;
  v_date date := (now() at time zone 'Asia/Tokyo')::date;
  v_daily public.daily_movement%rowtype;
  v_award integer := 0;
  v_status text := 'accepted';
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);

  select * into v_session from public.tag_sessions
    where id = p_session_id and user_id = v_user for update;
  if v_session.id is null or v_session.status <> 'active' then raise exception 'TAG session is not active'; end if;
  if v_session.expires_at <= now() then
    update public.tag_sessions set status = 'expired', ended_at = now() where id = v_session.id;
    raise exception 'TAG session expired';
  end if;
  if p_latitude < 35.49 or p_latitude > 35.90 or p_longitude < 138.94 or p_longitude > 139.93 then
    raise exception 'TAG ON is available only in Tokyo';
  end if;
  if p_accuracy_m is null or p_accuracy_m > 75 then v_status := 'poor_accuracy'; end if;
  if p_captured_at > now() + interval '30 seconds' or p_captured_at < now() - interval '3 minutes' then
    v_status := 'invalid_timestamp';
  end if;

  select * into v_last from public.location_samples
    where session_id = v_session.id order by captured_at desc limit 1;
  if v_last.id is not null then
    v_elapsed_seconds := extract(epoch from (p_captured_at - v_last.captured_at));
    if v_elapsed_seconds <= 4 then v_status := 'duplicate'; end if;
    v_distance := public.distance_meters(v_last.latitude, v_last.longitude, p_latitude, p_longitude);
    if v_distance < 25 then v_status := 'jitter'; end if;
    if v_elapsed_seconds > 0 then v_speed_kmh := (v_distance / v_elapsed_seconds) * 3.6; end if;
    if v_speed_kmh >= 15 then v_status := 'speed_rejected';
    elsif v_speed_kmh > 12 then v_status := 'speed_held';
    end if;
    if v_distance > 1500 then v_status := 'warp_rejected'; end if;
  end if;

  if v_status = 'accepted' then
    insert into public.location_samples (session_id,latitude,longitude,accuracy_m,captured_at,delete_at)
      values (v_session.id,p_latitude,p_longitude,p_accuracy_m,p_captured_at,least(p_delete_at,now()+interval '24 hours'));

    insert into public.daily_movement (user_id,movement_date)
      values (v_user,v_date) on conflict do nothing;
    select * into v_daily from public.daily_movement
      where user_id=v_user and movement_date=v_date for update;

    v_award := greatest(0, least(100 - v_daily.earned_exp,
      floor((v_daily.valid_distance_m + v_distance) / 100)::integer * 2 - v_daily.earned_exp));
    update public.daily_movement set
      valid_distance_m = valid_distance_m + v_distance,
      earned_exp = earned_exp + v_award,
      updated_at = now()
      where user_id=v_user and movement_date=v_date
      returning * into v_daily;
    update public.tag_sessions set
      valid_distance_m = valid_distance_m + v_distance,
      walk_exp_earned = walk_exp_earned + v_award
      where id=v_session.id
      returning * into v_session;
    if v_award > 0 then
      perform public.issue_exp(v_user,v_award,'walk','tag_session',v_session.id::text);
    end if;
  else
    insert into public.daily_movement (user_id,movement_date)
      values (v_user,v_date) on conflict do nothing;
    select * into v_daily from public.daily_movement where user_id=v_user and movement_date=v_date;
  end if;

  return query select
    case when v_status='accepted' then v_distance else 0 end,
    v_award,
    v_session.valid_distance_m,
    v_session.walk_exp_earned,
    v_daily.valid_distance_m,
    v_daily.earned_exp,
    100,
    v_status;
end $$;

create or replace function public.finish_tag_session()
returns table(
  session_id uuid,
  duration_seconds integer,
  distance_m double precision,
  walk_exp integer,
  cross_count integer,
  spot_count integer,
  areas text[]
) language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_session public.tag_sessions%rowtype;
begin
  v_user := public.current_app_user_id();
  select * into v_session from public.tag_sessions
    where user_id=v_user and status='active' order by started_at desc limit 1 for update;
  if v_session.id is null then raise exception 'TAG session is not active'; end if;
  update public.tag_sessions set status='stopped', ended_at=now() where id=v_session.id;
  return query select
    v_session.id,
    greatest(0, extract(epoch from (least(now(),v_session.expires_at)-v_session.started_at))::integer),
    v_session.valid_distance_m,
    v_session.walk_exp_earned,
    (select count(*)::integer from public.crossings c where (c.user_a=v_user or c.user_b=v_user) and c.crossed_at between v_session.started_at and now()),
    (select count(*)::integer from public.tag_spot_draws d where d.user_id=v_user and d.created_at between v_session.started_at and now()),
    coalesce((select array_agg(distinct c.area_label) from public.crossings c where (c.user_a=v_user or c.user_b=v_user) and c.crossed_at between v_session.started_at and now()), array[]::text[]);
end $$;

create or replace function public.get_today_movement()
returns table(distance_m double precision, walk_exp integer, daily_cap integer)
language sql security definer set search_path = public as $$
  select coalesce(m.valid_distance_m,0), coalesce(m.earned_exp,0), 100
  from (select public.current_app_user_id() as user_id) u
  left join public.daily_movement m on m.user_id=u.user_id
    and m.movement_date=(now() at time zone 'Asia/Tokyo')::date
$$;

revoke all on public.daily_movement from anon, authenticated;
grant select on public.daily_movement to authenticated;
grant execute on function public.update_tag_location(uuid,double precision,double precision,double precision,timestamptz,timestamptz) to authenticated;
grant execute on function public.finish_tag_session() to authenticated;
grant execute on function public.get_today_movement() to authenticated;
