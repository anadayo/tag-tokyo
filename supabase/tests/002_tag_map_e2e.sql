-- Transactional TAG ON, movement, CROSS, MAP and SPOT E2E.
begin;

update public.live_launch_controls set live_interactions_enabled=true,updated_at=now() where singleton;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('e2e00000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2e-tag-a@invalid.test','',now(),'{"provider":"email","providers":["email"]}','{"birth_date":"1990-01-01"}',now(),now()),
  ('e2e00000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2e-tag-b@invalid.test','',now(),'{"provider":"email","providers":["email"]}','{"birth_date":"1990-01-01"}',now(),now());

do $$
declare
  v_a uuid;v_b uuid;v_session_a uuid;v_session_b uuid;v_crossing uuid;
  v_match uuid;v_reward record;v_move record;v_finish record;
  v_before_balance bigint;v_after_balance bigint;v_before_boost integer;v_after_boost integer;
  v_duplicate_rejected boolean:=false;v_far_area_rejected boolean:=false;v_matched boolean;
begin
  select id into v_a from public.users where auth_user_id='e2e00000-0000-4000-8000-000000000003';
  select id into v_b from public.users where auth_user_id='e2e00000-0000-4000-8000-000000000004';
  if v_a is null or v_b is null then raise exception 'auth trigger did not create TAG users';end if;

  update public.users set
    birth_date='1990-01-01',age_verified=true,age_verification_status='verified',age_verified_at=now(),
    age_verification_method='e2e',age_verification_reference='rollback-only',terms_version='e2e',terms_accepted_at=now(),
    privacy_version='e2e',privacy_accepted_at=now(),last_seen_at=now()
  where id in(v_a,v_b);
  insert into public.profiles(user_id,display_name,handle,gender,interested_in,bio,total_earned_exp,available_exp)
  values(v_a,'TAG E2E A','tag_e2e_a','man','woman','rollback-only',2000,2000),
        (v_b,'TAG E2E B','tag_e2e_b','woman','man','rollback-only',2000,2000);
  insert into public.user_tags(user_id,tag_id,is_primary,sort_order)
  select member.id,t.id,true,row_number() over(order by t.id)::smallint
  from(values(v_a),(v_b)) member(id)
  cross join lateral(select id from public.tags where status='active' order by id limit 5)t;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000003',true);
  select public.start_tag_session(35.6580,139.7016,10,30,now()+interval '24 hours') into v_session_a;
  if v_session_a is null then raise exception 'TAG ON did not start';end if;
  if not exists(select 1 from public.location_samples where session_id=v_session_a and accuracy_m=10) then
    raise exception 'initial GPS accuracy was not stored';
  end if;

  update public.location_samples set captured_at=now()-interval '40 seconds' where session_id=v_session_a;
  select * into v_move from public.update_tag_location(v_session_a,35.6580,139.7027,10,now(),now()+interval '24 hours');
  if v_move.sample_status<>'accepted' or v_move.accepted_distance_m<25 then raise exception 'valid movement was not accepted';end if;

  select coalesce(quantity,0) into v_before_boost from public.user_consumables where user_id=v_a and item_key='beta-boost';
  select * into v_reward from public.draw_tag_spot('spot-shibuya',35.6580,139.7027);
  if v_reward.reward_key is null then raise exception 'TAG SPOT returned no reward';end if;
  if not exists(select 1 from public.tag_spot_draws where user_id=v_a and spot_id='spot-shibuya') then raise exception 'SPOT draw was not recorded';end if;
  select coalesce(quantity,0) into v_after_boost from public.user_consumables where user_id=v_a and item_key='beta-boost';
  if v_reward.reward_key='spot-sr' and v_after_boost<>v_before_boost+1 then raise exception 'BOOST inventory was not granted';end if;
  if v_reward.reward_key='spot-ssr' and v_after_boost<>least(99,v_before_boost+3) then raise exception 'SUPER BOOST inventory was not granted';end if;

  begin perform public.draw_tag_spot('spot-shibuya',35.6580,139.7027);
  exception when others then v_duplicate_rejected:=true;end;
  if not v_duplicate_rejected then raise exception 'second daily SPOT draw was accepted';end if;

  select available_exp into v_before_balance from public.profiles where user_id=v_a;
  perform public.contribute_area_exp('shibuya',100,35.6580,139.7027);
  select available_exp into v_after_balance from public.profiles where user_id=v_a;
  if v_after_balance<>v_before_balance-100 then raise exception 'area contribution did not spend exactly 100 EXP';end if;
  begin perform public.contribute_area_exp('kitasenju',100,35.6580,139.7027);
  exception when others then v_far_area_rejected:=true;end;
  if not v_far_area_rejected then raise exception 'far-area contribution was accepted';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000004',true);
  select public.start_tag_session(35.6580,139.7027,10,30,now()+interval '24 hours') into v_session_b;
  perform public.detect_crossings_private(1000,3);
  select id into v_crossing from public.crossings where user_a=least(v_a,v_b) and user_b=greatest(v_a,v_b) and expires_at>now();
  if v_crossing is null then raise exception 'CROSS was not detected';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000003',true);
  select public.send_crossing_tag(v_crossing) into v_matched;
  if v_matched then raise exception 'one-way TAG created a match';end if;
  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000004',true);
  select public.send_crossing_tag(v_crossing) into v_matched;
  if not v_matched then raise exception 'mutual TAG did not create a match';end if;
  select id into v_match from public.matches where crossing_id=v_crossing and ended_at is null;
  if v_match is null then raise exception 'mutual TAG match record missing';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000003',true);
  select * into v_finish from public.finish_tag_session();
  if v_finish.spot_count<>1 or v_finish.cross_count<>1 then raise exception 'TAG result summary is incorrect';end if;
  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000004',true);
  perform public.finish_tag_session();
end $$;

rollback;
