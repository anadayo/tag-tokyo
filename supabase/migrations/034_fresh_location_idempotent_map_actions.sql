-- Fresh GPS validation and idempotent MAP actions.

create table if not exists public.area_contribution_requests (
  request_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  area_id text not null references public.areas(id) on delete cascade,
  amount integer not null,
  distance_m double precision not null,
  points_after bigint not null,
  balance_after bigint not null,
  previous_level integer not null,
  new_level integer not null,
  created_at timestamptz not null default now()
);
alter table public.area_contribution_requests enable row level security;
revoke all on public.area_contribution_requests from public,anon,authenticated;

alter table public.tag_spot_draws add column if not exists request_id uuid;
create unique index if not exists tag_spot_draws_request_uidx on public.tag_spot_draws(request_id) where request_id is not null;

create or replace function public.contribute_area_exp_v2(
  p_request_id uuid,p_area_id text,p_amount integer,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_captured_at timestamptz
) returns table(points_after bigint,distance_m double precision,balance_after bigint,previous_level integer,new_level integer,event_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid;v_area public.areas%rowtype;v_session public.tag_sessions%rowtype;v_distance double precision;
  v_points bigint;v_balance bigint;v_total bigint;v_previous_level integer;v_new_level integer;v_inserted integer;
  v_existing public.area_contribution_requests%rowtype;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  if p_request_id is null then raise exception 'request id required';end if;
  select * into v_existing from public.area_contribution_requests where request_id=p_request_id and user_id=v_user;
  if v_existing.request_id is not null then
    return query select v_existing.points_after,v_existing.distance_m,v_existing.balance_after,v_existing.previous_level,v_existing.new_level,v_existing.request_id;
    return;
  end if;
  if p_amount<100 or p_amount>1000 or p_amount%100<>0 then raise exception 'invalid contribution';end if;
  if p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then raise exception 'location accuracy is insufficient';end if;
  if p_captured_at is null or p_captured_at<now()-interval '30 seconds' or p_captured_at>now()+interval '10 seconds' then
    raise exception 'fresh location required';
  end if;
  if p_latitude<35.49 or p_latitude>35.90 or p_longitude<138.94 or p_longitude>139.93 then raise exception 'location outside Tokyo';end if;
  select * into v_session from public.tag_sessions where user_id=v_user and status='active' and expires_at>now() order by started_at desc limit 1;
  if v_session.id is null then raise exception 'active TAG ON session required';end if;
  select * into v_area from public.areas where id=p_area_id and active;
  if v_area.id is null then raise exception 'area unavailable';end if;
  v_distance:=public.distance_meters(p_latitude,p_longitude,v_area.latitude,v_area.longitude);
  if v_distance>v_area.contribution_radius_m then raise exception 'outside area range: % meters',round(v_distance);end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select * into v_existing from public.area_contribution_requests where request_id=p_request_id and user_id=v_user;
  if v_existing.request_id is not null then
    return query select v_existing.points_after,v_existing.distance_m,v_existing.balance_after,v_existing.previous_level,v_existing.new_level,v_existing.request_id;
    return;
  end if;
  select available_exp,total_earned_exp into v_balance,v_total from public.profiles where user_id=v_user for update;
  v_previous_level:=public.profile_level_for_exp(v_total);
  perform public.spend_exp(v_user,p_amount,'area_contribution','area',p_area_id);
  insert into public.area_contributions(area_id,user_id,points) values(p_area_id,v_user,p_amount)
    on conflict(area_id,user_id) do update set points=public.area_contributions.points+excluded.points,updated_at=now()
    returning points into v_points;
  select available_exp,total_earned_exp into v_balance,v_total from public.profiles where user_id=v_user;
  v_new_level:=public.profile_level_for_exp(v_total);
  insert into public.location_samples(session_id,latitude,longitude,accuracy_m,captured_at,delete_at)
    values(v_session.id,p_latitude,p_longitude,p_accuracy_m,p_captured_at,least(now()+interval '24 hours',v_session.expires_at+interval '24 hours'));
  insert into public.area_contribution_requests(request_id,user_id,area_id,amount,distance_m,points_after,balance_after,previous_level,new_level)
    values(p_request_id,v_user,p_area_id,p_amount,v_distance,v_points,v_balance,v_previous_level,v_new_level)
    on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    select * into v_existing from public.area_contribution_requests where request_id=p_request_id and user_id=v_user;
    return query select v_existing.points_after,v_existing.distance_m,v_existing.balance_after,v_existing.previous_level,v_existing.new_level,v_existing.request_id;
    return;
  end if;
  return query select v_points,v_distance,v_balance,v_previous_level,v_new_level,p_request_id;
end $$;

create or replace function public.draw_tag_spot_v2(
  p_request_id uuid,p_spot_id text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_captured_at timestamptz
) returns table(reward_type text,reward_key text,reward_exp integer,distance_m double precision,request_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid;v_spot public.tag_spots%rowtype;v_session public.tag_sessions%rowtype;v_existing public.tag_spot_draws%rowtype;
  v_roll double precision;v_type text;v_key text;v_exp integer;v_boost_quantity integer:=0;v_distance double precision;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  if p_request_id is null then raise exception 'request id required';end if;
  select * into v_existing from public.tag_spot_draws where request_id=p_request_id and user_id=v_user;
  if v_existing.id is not null then
    select public.distance_meters(p_latitude,p_longitude,s.latitude,s.longitude) into v_distance
      from public.tag_spots s where s.id=v_existing.spot_id;
    return query select v_existing.reward_type,v_existing.reward_key,v_existing.reward_exp,
      v_distance,p_request_id;
    return;
  end if;
  if p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then raise exception 'location accuracy is insufficient';end if;
  if p_captured_at is null or p_captured_at<now()-interval '30 seconds' or p_captured_at>now()+interval '10 seconds' then raise exception 'fresh location required';end if;
  select * into v_session from public.tag_sessions where user_id=v_user and status='active' and expires_at>now() order by started_at desc limit 1;
  if v_session.id is null then raise exception 'active TAG ON session required';end if;
  select * into v_spot from public.tag_spots where id=p_spot_id and active;
  if v_spot.id is null then raise exception 'spot unavailable';end if;
  v_distance:=public.distance_meters(p_latitude,p_longitude,v_spot.latitude,v_spot.longitude);
  if v_distance>v_spot.radius_m then raise exception 'outside spot range: % meters',round(v_distance);end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text||p_spot_id||((now() at time zone 'Asia/Tokyo')::date)::text));
  select * into v_existing from public.tag_spot_draws where request_id=p_request_id and user_id=v_user;
  if v_existing.id is not null then
    return query select v_existing.reward_type,v_existing.reward_key,v_existing.reward_exp,v_distance,p_request_id;
    return;
  end if;
  select * into v_existing from public.tag_spot_draws where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date;
  if v_existing.id is not null then raise exception 'already drawn today';end if;
  v_roll:=random();
  if v_roll<1.0/300 then v_type:='cosmetic';v_key:='spot-ssr';v_exp:=0;v_boost_quantity:=3;
  elsif v_roll<1.0/80 then v_type:='cosmetic';v_key:='spot-sr';v_exp:=0;v_boost_quantity:=1;
  elsif v_roll<1.0/25 then v_type:='cosmetic';v_key:='spot-rare';v_exp:=0;
  elsif v_roll<0.12 then v_type:='exp';v_key:='exp-100';v_exp:=100;
  elsif v_roll<0.37 then v_type:='exp';v_key:='exp-50';v_exp:=50;
  else v_type:='exp';v_key:='exp-30';v_exp:=30;end if;
  insert into public.tag_spot_draws(user_id,spot_id,reward_type,reward_key,reward_exp,request_id)
    values(v_user,p_spot_id,v_type,v_key,v_exp,p_request_id);
  if v_boost_quantity>0 then
    insert into public.user_consumables(user_id,item_key,quantity) values(v_user,'beta-boost',v_boost_quantity)
      on conflict(user_id,item_key) do update set quantity=least(99,public.user_consumables.quantity+excluded.quantity),updated_at=now();
  elsif v_type='cosmetic' and exists(select 1 from public.user_cosmetics where user_id=v_user and cosmetic_id=v_key) then
    v_type:='exp';v_key:='duplicate-compensation';v_exp:=100;
    update public.tag_spot_draws set reward_type=v_type,reward_key=v_key,reward_exp=v_exp where request_id=p_request_id;
    perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  elsif v_type='exp' then perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  else insert into public.user_cosmetics(user_id,cosmetic_id,source) values(v_user,v_key,'tag_spot') on conflict do nothing;
  end if;
  insert into public.location_samples(session_id,latitude,longitude,accuracy_m,captured_at,delete_at)
    values(v_session.id,p_latitude,p_longitude,p_accuracy_m,p_captured_at,least(now()+interval '24 hours',v_session.expires_at+interval '24 hours'));
  return query select v_type,v_key,v_exp,v_distance,p_request_id;
end $$;

revoke all on function public.contribute_area_exp_v2(uuid,text,integer,double precision,double precision,double precision,timestamptz) from public,anon;
revoke all on function public.draw_tag_spot_v2(uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.contribute_area_exp_v2(uuid,text,integer,double precision,double precision,double precision,timestamptz) to authenticated;
grant execute on function public.draw_tag_spot_v2(uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;
