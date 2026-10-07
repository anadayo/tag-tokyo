-- TAG/MAP release fixes: preserve initial GPS accuracy and make spot BOOSTs usable.

create or replace function public.start_tag_session(
  p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,
  p_duration_minutes integer,p_delete_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_session uuid;
begin
  v_user:=public.current_app_user_id();
  perform public.assert_live_member(v_user);
  if p_duration_minutes<>30 then raise exception 'TAG ON sessions are limited to 30 minutes';end if;
  if p_latitude<35.49 or p_latitude>35.90 or p_longitude<138.94 or p_longitude>139.93 then
    raise exception 'TAG ON is available only in Tokyo';
  end if;
  if p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>5000 then raise exception 'invalid location accuracy';end if;
  update public.tag_sessions set status='stopped',ended_at=now() where user_id=v_user and status='active';
  insert into public.tag_sessions(user_id,expires_at,duration_minutes)
    values(v_user,now()+interval '30 minutes',30) returning id into v_session;
  insert into public.location_samples(session_id,latitude,longitude,accuracy_m,captured_at,delete_at)
    values(v_session,p_latitude,p_longitude,p_accuracy_m,now(),least(p_delete_at,now()+interval '24 hours'));
  return v_session;
end $$;

create or replace function public.draw_tag_spot(
  p_spot_id text,p_latitude double precision,p_longitude double precision
) returns table(reward_type text,reward_key text,reward_exp integer)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid;v_spot public.tag_spots%rowtype;v_location public.location_samples%rowtype;
  v_roll double precision;v_type text;v_key text;v_exp integer;v_boost_quantity integer:=0;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  select * into v_spot from public.tag_spots where id=p_spot_id and active;
  if v_spot.id is null then raise exception 'spot unavailable';end if;
  select ls.* into v_location from public.location_samples ls join public.tag_sessions s on s.id=ls.session_id
    where s.user_id=v_user and s.status='active' and s.expires_at>now() and ls.captured_at>now()-interval '2 minutes'
      and coalesce(ls.accuracy_m,9999)<=75 order by ls.captured_at desc limit 1;
  if v_location.id is null then raise exception 'recent accurate TAG ON location required';end if;
  if public.distance_meters(v_location.latitude,v_location.longitude,v_spot.latitude,v_spot.longitude)>v_spot.radius_m then
    raise exception 'move closer to TAG SPOT';
  end if;
  if exists(select 1 from public.tag_spot_draws where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date) then
    raise exception 'already drawn today';
  end if;

  v_roll:=random();
  if v_roll<1.0/300 then v_type:='cosmetic';v_key:='spot-ssr';v_exp:=0;v_boost_quantity:=3;
  elsif v_roll<1.0/80 then v_type:='cosmetic';v_key:='spot-sr';v_exp:=0;v_boost_quantity:=1;
  elsif v_roll<1.0/25 then v_type:='cosmetic';v_key:='spot-rare';v_exp:=0;
  elsif v_roll<0.12 then v_type:='exp';v_key:='exp-100';v_exp:=100;
  elsif v_roll<0.37 then v_type:='exp';v_key:='exp-50';v_exp:=50;
  else v_type:='exp';v_key:='exp-30';v_exp:=30;end if;

  insert into public.tag_spot_draws(user_id,spot_id,reward_type,reward_key,reward_exp)
    values(v_user,p_spot_id,v_type,v_key,v_exp);

  if v_boost_quantity>0 then
    insert into public.user_consumables(user_id,item_key,quantity)
      values(v_user,'beta-boost',v_boost_quantity)
      on conflict(user_id,item_key) do update set
        quantity=least(99,public.user_consumables.quantity+excluded.quantity),updated_at=now();
  elsif v_type='cosmetic' and exists(select 1 from public.user_cosmetics where user_id=v_user and cosmetic_id=v_key) then
    v_type:='exp';v_key:='duplicate-compensation';v_exp:=100;
    update public.tag_spot_draws set reward_type=v_type,reward_key=v_key,reward_exp=v_exp
      where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date;
    perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  elsif v_type='exp' then
    perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  else
    insert into public.user_cosmetics(user_id,cosmetic_id,source) values(v_user,v_key,'tag_spot') on conflict do nothing;
  end if;
  return query select v_type,v_key,v_exp;
end $$;

revoke all on function public.start_tag_session(double precision,double precision,double precision,integer,timestamptz) from public,anon;
revoke all on function public.draw_tag_spot(text,double precision,double precision) from public,anon;
grant execute on function public.start_tag_session(double precision,double precision,double precision,integer,timestamptz) to authenticated;
grant execute on function public.draw_tag_spot(text,double precision,double precision) to authenticated;
