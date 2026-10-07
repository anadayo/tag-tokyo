-- Transactional live-community E2E. This leaves no users or interaction data.
begin;

update public.live_launch_controls
set live_interactions_enabled=true,notes='transactional E2E only',updated_at=now()
where singleton;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('e2e00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2e-a@invalid.test','',now(),'{"provider":"email","providers":["email"]}','{"birth_date":"1990-01-01"}',now(),now()),
  ('e2e00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2e-b@invalid.test','',now(),'{"provider":"email","providers":["email"]}','{"birth_date":"1990-01-01"}',now(),now());

do $$
declare
  v_a uuid;
  v_b uuid;
  v_match uuid;
  v_message bigint;
  v_report bigint;
  v_matched boolean;
  v_read integer;
  v_blocked_send boolean:=false;
begin
  select id into v_a from public.users where auth_user_id='e2e00000-0000-4000-8000-000000000001';
  select id into v_b from public.users where auth_user_id='e2e00000-0000-4000-8000-000000000002';
  if v_a is null or v_b is null then raise exception 'auth trigger did not create app users';end if;

  update public.users set
    birth_date='1990-01-01',age_verified=true,age_verification_status='verified',
    age_verified_at=now(),age_verification_method='e2e',age_verification_reference='rollback-only',
    terms_version='e2e',terms_accepted_at=now(),privacy_version='e2e',privacy_accepted_at=now(),last_seen_at=now()
  where id in(v_a,v_b);

  insert into public.profiles(user_id,display_name,handle,gender,interested_in,bio)
  values(v_a,'E2E A','e2e_user_a','man','woman','rollback-only'),
        (v_b,'E2E B','e2e_user_b','woman','man','rollback-only');

  insert into public.user_tags(user_id,tag_id,is_primary,sort_order)
  select member.id,t.id,true,row_number() over(order by t.id)::smallint
  from(values(v_a),(v_b)) member(id)
  cross join lateral(select id from public.tags where status='active' order by id limit 5)t;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000001',true);
  select public.send_profile_like(v_b) into v_matched;
  if v_matched then raise exception 'one-way LIKE created a match';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000002',true);
  select public.send_profile_like(v_a) into v_matched;
  if not v_matched then raise exception 'mutual LIKE did not create a match';end if;
  select id into v_match from public.matches where user_a=least(v_a,v_b) and user_b=greatest(v_a,v_b) and ended_at is null;
  if v_match is null then raise exception 'active match record missing';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000001',true);
  select id into v_message from public.send_match_message(v_match,'E2E hello');
  if v_message is null then raise exception 'message was not created';end if;

  perform set_config('request.jwt.claim.sub','e2e00000-0000-4000-8000-000000000002',true);
  select public.mark_match_read(v_match) into v_read;
  if v_read<>1 then raise exception 'read receipt was not recorded';end if;
  perform public.react_to_message(v_message,'heart');
  select public.report_match_member(v_match,'unsafe','transactional E2E') into v_report;
  if v_report is null then raise exception 'report was not created';end if;
  perform public.block_match_member(v_match);

  if not exists(select 1 from public.blocks where blocker_id=v_b and blocked_id=v_a) then raise exception 'block was not created';end if;
  if exists(select 1 from public.matches where id=v_match and ended_at is null) then raise exception 'block did not end match';end if;
  if exists(select 1 from public.discovery_likes where(sender_id,receiver_id) in((v_a,v_b),(v_b,v_a))) then raise exception 'block did not clear likes';end if;

  begin
    perform public.send_match_message(v_match,'must fail');
  exception when others then
    v_blocked_send:=true;
  end;
  if not v_blocked_send then raise exception 'message succeeded after block';end if;
end $$;

rollback;
