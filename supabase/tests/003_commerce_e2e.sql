-- Transactional commerce E2E. No Stripe call is made and all rows are rolled back.
begin;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'e2e00000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','e2e-commerce@invalid.test','',now(),
  '{"provider":"email","providers":["email"]}','{"birth_date":"1990-01-01"}',now(),now()
);

do $$
declare
  v_user uuid;
  v_paid_order uuid;
  v_expired_order uuid;
  v_result text;
  v_quantity integer;
  v_refund_entries integer;
begin
  select id into v_user from public.users
  where auth_user_id='e2e00000-0000-4000-8000-000000000005';
  if v_user is null then raise exception 'auth trigger did not create commerce user';end if;

  update public.users set
    birth_date='1990-01-01',age_verified=true,age_verification_status='verified',
    age_verified_at=now(),age_verification_method='e2e',age_verification_reference='rollback-only',
    terms_version='e2e',terms_accepted_at=now(),privacy_version='e2e',privacy_accepted_at=now(),last_seen_at=now()
  where id=v_user;

  insert into public.payment_orders(
    user_id,product_key,stripe_checkout_session_id,amount_total,currency
  ) values(v_user,'boost','cs_e2e_paid',800,'jpy') returning id into v_paid_order;

  select public.process_stripe_event(
    'evt_e2e_paid_1','checkout.session.completed',v_paid_order,'cs_e2e_paid',
    'pi_e2e_paid','paid',800,'jpy',0
  ) into v_result;
  if v_result<>'paid' then raise exception 'paid event returned %',v_result;end if;

  select quantity into v_quantity from public.user_consumables
  where user_id=v_user and item_key='boost';
  if v_quantity<>1 then raise exception 'purchase grant expected 1, got %',v_quantity;end if;

  select public.process_stripe_event(
    'evt_e2e_paid_2','checkout.session.async_payment_succeeded',v_paid_order,'cs_e2e_paid',
    'pi_e2e_paid','paid',800,'jpy',0
  ) into v_result;
  select quantity into v_quantity from public.user_consumables
  where user_id=v_user and item_key='boost';
  if v_result<>'already_paid' or v_quantity<>1 then
    raise exception 'different success events granted twice: result %, quantity %',v_result,v_quantity;
  end if;

  select public.process_stripe_event(
    'evt_e2e_refund_1','charge.refunded',v_paid_order,null,'pi_e2e_paid','paid',800,'jpy',800
  ) into v_result;
  select quantity into v_quantity from public.user_consumables
  where user_id=v_user and item_key='boost';
  if v_result<>'refunded' or v_quantity<>0 then
    raise exception 'full refund did not reverse available inventory';
  end if;

  perform public.process_stripe_event(
    'evt_e2e_refund_2','charge.refunded',v_paid_order,null,'pi_e2e_paid','paid',800,'jpy',800
  );
  select quantity into v_quantity from public.user_consumables
  where user_id=v_user and item_key='boost';
  select count(*) into v_refund_entries from public.commerce_ledger
  where order_id=v_paid_order and entry_type='refund';
  if v_quantity<>0 or v_refund_entries<>1 then
    raise exception 'duplicate full refund was applied more than once';
  end if;

  insert into public.payment_orders(user_id,product_key,stripe_checkout_session_id,amount_total,currency)
  values(v_user,'super-boost','cs_e2e_expired',1500,'jpy') returning id into v_expired_order;
  perform public.process_stripe_event(
    'evt_e2e_expired','checkout.session.expired',v_expired_order,'cs_e2e_expired',null,'unpaid',1500,'jpy',0
  );
  if not exists(select 1 from public.payment_orders where id=v_expired_order and status='cancelled') then
    raise exception 'expired checkout was not cancelled';
  end if;
end $$;

rollback;
