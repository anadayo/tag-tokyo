-- TAG TOKYO commerce foundation.
-- Sales remain disabled until Stripe, legal disclosures and operator review are complete.

create table if not exists public.commerce_controls (
  singleton boolean primary key default true check (singleton),
  purchases_enabled boolean not null default false,
  legal_review_completed boolean not null default false,
  stripe_test_mode boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.commerce_controls (singleton) values (true) on conflict do nothing;

create table if not exists public.commerce_products (
  product_key text primary key,
  name text not null,
  description text not null,
  unit_amount integer not null check (unit_amount > 0),
  currency text not null default 'jpy' check (currency = 'jpy'),
  item_key text not null check (item_key in ('boost', 'super-boost')),
  item_quantity integer not null default 1 check (item_quantity between 1 and 10),
  duration_minutes integer not null check (duration_minutes between 1 and 180),
  range_meters integer not null check (range_meters between 1000 and 10000),
  active boolean not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.commerce_products
  (product_key, name, description, unit_amount, item_key, item_quantity, duration_minutes, range_meters, sort_order)
values
  ('boost', 'BOOST', 'CROSS探索範囲を30分間5kmへ拡張', 800, 'boost', 1, 30, 5000, 10),
  ('super-boost', 'SUPER BOOST', 'CROSS探索範囲を30分間10kmへ拡張', 1500, 'super-boost', 1, 30, 10000, 20)
on conflict (product_key) do update set
  name = excluded.name,
  description = excluded.description,
  unit_amount = excluded.unit_amount,
  item_key = excluded.item_key,
  item_quantity = excluded.item_quantity,
  duration_minutes = excluded.duration_minutes,
  range_meters = excluded.range_meters,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  product_key text not null references public.commerce_products(product_key),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_total integer not null check (amount_total > 0),
  currency text not null check (currency = 'jpy'),
  status text not null default 'created' check (status in ('created','paid','failed','cancelled','refunded','partially_refunded')),
  amount_refunded integer not null default 0 check (amount_refunded >= 0),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_orders_user_created_idx on public.payment_orders(user_id, created_at desc);
create index if not exists payment_orders_status_created_idx on public.payment_orders(status, created_at desc);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  order_id uuid references public.payment_orders(id),
  processed_at timestamptz not null default now()
);

create table if not exists public.commerce_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete restrict,
  order_id uuid references public.payment_orders(id) on delete restrict,
  item_key text not null check (item_key in ('boost','super-boost')),
  quantity_delta integer not null check (quantity_delta <> 0 and abs(quantity_delta) <= 10),
  entry_type text not null check (entry_type in ('purchase','consume','refund','adjustment')),
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique(entry_type, reference_id, item_key)
);
create index if not exists commerce_ledger_user_created_idx on public.commerce_ledger(user_id, created_at desc);

alter table public.user_consumables drop constraint if exists user_consumables_item_key_check;
alter table public.user_consumables add constraint user_consumables_item_key_check
  check (item_key in ('beta-boost','boost','super-boost'));
alter table public.active_boosts drop constraint if exists active_boosts_item_key_check;
alter table public.active_boosts add constraint active_boosts_item_key_check
  check (item_key in ('beta-boost','boost','super-boost'));

create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'visit','registration_start','email_auth_complete','tag_on_started',
    'cross_created','match_created','checkout_started','purchase_completed','refund_completed'
  )),
  anonymous_session_id uuid not null,
  user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists product_events_name_created_idx on public.product_events(event_name, created_at desc);
create index if not exists product_events_session_created_idx on public.product_events(anonymous_session_id, created_at desc);

alter table public.commerce_controls enable row level security;
alter table public.commerce_products enable row level security;
alter table public.payment_orders enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.commerce_ledger enable row level security;
alter table public.product_events enable row level security;

create policy payment_orders_self_read on public.payment_orders for select
  using (user_id = public.current_app_user_id());
create policy commerce_ledger_self_read on public.commerce_ledger for select
  using (user_id = public.current_app_user_id());

create or replace function public.get_commerce_catalog()
returns table(product_key text,name text,description text,unit_amount integer,currency text,
  item_key text,item_quantity integer,duration_minutes integer,range_meters integer,purchases_enabled boolean)
language sql stable security definer set search_path=public as $$
  select p.product_key,p.name,p.description,p.unit_amount,p.currency,p.item_key,p.item_quantity,
    p.duration_minutes,p.range_meters,
    coalesce(c.purchases_enabled and c.legal_review_completed,false)
  from public.commerce_products p
  cross join public.commerce_controls c
  where p.active and c.singleton
  order by p.sort_order,p.product_key
$$;

create or replace function public.get_my_commerce_history()
returns table(order_id uuid,product_key text,amount_total integer,currency text,status text,
  amount_refunded integer,created_at timestamptz,paid_at timestamptz)
language sql stable security definer set search_path=public as $$
  select o.id,o.product_key,o.amount_total,o.currency,o.status,o.amount_refunded,o.created_at,o.paid_at
  from public.payment_orders o
  where o.user_id=public.current_app_user_id()
  order by o.created_at desc limit 50
$$;

create or replace function public.get_my_commerce_inventory()
returns table(item_key text,quantity integer,active_until timestamptz,active_item_key text)
language sql stable security definer set search_path=public as $$
  with me as (select public.current_app_user_id() user_id), items as (
    select unnest(array['boost','super-boost']::text[]) item_key
  )
  select items.item_key,coalesce(c.quantity,0),
    case when b.expires_at>now() then b.expires_at else null end,
    case when b.expires_at>now() then b.item_key else null end
  from items cross join me
  left join public.user_consumables c on c.user_id=me.user_id and c.item_key=items.item_key
  left join public.active_boosts b on b.user_id=me.user_id
$$;

create or replace function public.activate_consumable(p_item_key text)
returns table(item_key text,expires_at timestamptz,range_meters integer)
language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_expires timestamptz;v_range integer;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  if p_item_key not in ('boost','super-boost') then raise exception 'invalid item';end if;
  if exists(select 1 from public.active_boosts where user_id=v_user and expires_at>now()) then
    raise exception 'boost already active';
  end if;
  update public.user_consumables set quantity=quantity-1,updated_at=now()
    where user_id=v_user and item_key=p_item_key and quantity>0;
  if not found then raise exception 'item unavailable';end if;
  select range_meters into v_range from public.commerce_products where item_key=p_item_key and active limit 1;
  v_expires:=now()+interval '30 minutes';
  insert into public.active_boosts(user_id,item_key,activated_at,expires_at)
    values(v_user,p_item_key,now(),v_expires)
    on conflict(user_id) do update set item_key=excluded.item_key,activated_at=excluded.activated_at,expires_at=excluded.expires_at;
  insert into public.commerce_ledger(user_id,item_key,quantity_delta,entry_type,reference_id)
    values(v_user,p_item_key,-1,'consume',gen_random_uuid()::text);
  return query select p_item_key,v_expires,v_range;
end $$;

create or replace function public.record_product_event(
  p_event_name text,p_anonymous_session_id uuid,p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  if p_event_name not in ('visit','registration_start','email_auth_complete','tag_on_started','cross_created','match_created','checkout_started','purchase_completed','refund_completed') then
    raise exception 'unsupported event';
  end if;
  if p_anonymous_session_id is null then raise exception 'session required';end if;
  if octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>2048 then raise exception 'metadata too large';end if;
  if (select count(*) from public.product_events where anonymous_session_id=p_anonymous_session_id and created_at>now()-interval '1 hour')>=120 then
    return;
  end if;
  v_user:=public.current_app_user_id();
  insert into public.product_events(event_name,anonymous_session_id,user_id,metadata)
    values(p_event_name,p_anonymous_session_id,v_user,coalesce(p_metadata,'{}'::jsonb));
end $$;

create or replace function public.detect_crossings_private(p_radius_meters integer default 1000,p_overlap_minutes integer default 3)
returns integer language plpgsql security definer set search_path=public as $$
declare created_count integer;
begin
  with candidate_pairs as(
    select least(sa.user_id,sb.user_id) user_a,greatest(sa.user_id,sb.user_id) user_b,greatest(la.captured_at,lb.captured_at) crossed_at,
      case when(la.latitude+lb.latitude)/2<35.64 then '東京南部エリア' when(la.longitude+lb.longitude)/2<139.65 then '東京西部エリア' when(la.longitude+lb.longitude)/2>139.82 then '東京東部エリア' else '東京中央エリア' end area_label
    from public.tag_sessions sa join public.location_samples la on la.session_id=sa.id
    join public.tag_sessions sb on sb.id>sa.id and sb.status='active'
    join public.location_samples lb on lb.session_id=sb.id
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and abs(extract(epoch from(la.captured_at-lb.captured_at)))<=least(greatest(p_overlap_minutes,1),10)*60
      and public.profiles_are_mutually_interested(sa.user_id,sb.user_id)
      and public.distance_meters(la.latitude,la.longitude,lb.latitude,lb.longitude)<=greatest(
        least(greatest(p_radius_meters,100),1000),
        coalesce((select max(case ab.item_key when 'super-boost' then 10000 when 'boost' then 5000 else 1500 end)
          from public.active_boosts ab where ab.user_id in(sa.user_id,sb.user_id) and ab.expires_at>now()),1000)
      )
      and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as(
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('minute',crossed_at) from candidate_pairs on conflict do nothing returning 1
  )select count(*) into created_count from inserted;
  return created_count;
end $$;

create or replace function public.process_stripe_event(
  p_event_id text,p_event_type text,p_order_id uuid,p_checkout_session_id text,
  p_payment_intent_id text,p_payment_status text,p_amount integer,p_currency text,p_amount_refunded integer default 0
) returns text language plpgsql security definer set search_path=public as $$
declare v_order public.payment_orders%rowtype;v_product public.commerce_products%rowtype;v_user uuid;
begin
  if p_event_id is null or p_event_type is null then raise exception 'invalid event';end if;
  insert into public.stripe_webhook_events(event_id,event_type,order_id)
    values(p_event_id,p_event_type,p_order_id)
    on conflict(event_id) do nothing;
  if not found then return 'duplicate';end if;

  select * into v_order from public.payment_orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order not found';end if;
  select * into v_product from public.commerce_products where product_key=v_order.product_key;
  v_user:=v_order.user_id;

  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    if v_order.status in ('paid','partially_refunded','refunded') then return 'already_paid';end if;
    if p_payment_status <> 'paid' or p_amount <> v_order.amount_total or lower(p_currency) <> v_order.currency then
      raise exception 'payment validation failed';
    end if;
    if v_order.stripe_checkout_session_id is not null and p_checkout_session_id is distinct from v_order.stripe_checkout_session_id then
      raise exception 'checkout session mismatch';
    end if;
    update public.payment_orders set status='paid',stripe_checkout_session_id=coalesce(p_checkout_session_id,stripe_checkout_session_id),
      stripe_payment_intent_id=coalesce(p_payment_intent_id,stripe_payment_intent_id),paid_at=coalesce(paid_at,now()),updated_at=now()
      where id=v_order.id;
    insert into public.user_consumables(user_id,item_key,quantity)
      values(v_user,v_product.item_key,v_product.item_quantity)
      on conflict(user_id,item_key) do update set quantity=least(99,public.user_consumables.quantity+excluded.quantity),updated_at=now();
    insert into public.commerce_ledger(user_id,order_id,item_key,quantity_delta,entry_type,reference_id)
      values(v_user,v_order.id,v_product.item_key,v_product.item_quantity,'purchase',p_event_id)
      on conflict do nothing;
    return 'paid';
  elsif p_event_type in ('checkout.session.expired','checkout.session.async_payment_failed') then
    update public.payment_orders set status=case when p_event_type='checkout.session.expired' then 'cancelled' else 'failed' end,updated_at=now()
      where id=v_order.id and status='created';
    return 'closed';
  elsif p_event_type='charge.refunded' then
    update public.payment_orders set amount_refunded=greatest(amount_refunded,p_amount_refunded),
      status=case when p_amount_refunded>=amount_total then 'refunded' else 'partially_refunded' end,
      refunded_at=case when p_amount_refunded>=amount_total then now() else refunded_at end,updated_at=now()
      where id=v_order.id;
    if p_amount_refunded>=v_order.amount_total and v_order.amount_refunded<v_order.amount_total then
      update public.user_consumables set quantity=greatest(0,quantity-v_product.item_quantity),updated_at=now()
        where user_id=v_user and item_key=v_product.item_key;
      insert into public.commerce_ledger(user_id,order_id,item_key,quantity_delta,entry_type,reference_id)
        values(v_user,v_order.id,v_product.item_key,-v_product.item_quantity,'refund',p_event_id)
        on conflict do nothing;
    end if;
    return 'refunded';
  end if;
  return 'ignored';
end $$;

create or replace function public.get_commerce_admin_stats(p_days integer default 30)
returns table(visits bigint,registrations bigint,confirmed_emails bigint,tag_users bigint,crossings bigint,matches bigint,
  checkout_starts bigint,paid_orders bigint,gross_sales bigint,refund_total bigint)
language plpgsql stable security definer set search_path=public,auth as $$
declare v_since timestamptz:=now()-make_interval(days=>least(greatest(p_days,1),365));
begin
  if not public.is_moderator() then raise exception 'moderator access required';end if;
  return query select
    (select count(distinct anonymous_session_id) from public.product_events where event_name='visit' and created_at>=v_since),
    (select count(*) from public.users where not is_demo and created_at>=v_since),
    (select count(*) from auth.users where email_confirmed_at>=v_since),
    (select count(distinct user_id) from public.tag_sessions where started_at>=v_since),
    (select count(*) from public.crossings where created_at>=v_since),
    (select count(*) from public.matches where created_at>=v_since),
    (select count(*) from public.payment_orders where created_at>=v_since),
    (select count(*) from public.payment_orders where status in('paid','partially_refunded','refunded') and paid_at>=v_since),
    (select coalesce(sum(amount_total),0) from public.payment_orders where status in('paid','partially_refunded','refunded') and paid_at>=v_since),
    (select coalesce(sum(amount_refunded),0) from public.payment_orders where refunded_at>=v_since);
end $$;

revoke all on public.commerce_controls,public.commerce_products,public.payment_orders,public.stripe_webhook_events,public.commerce_ledger,public.product_events from anon,authenticated;
grant select on public.payment_orders,public.commerce_ledger to authenticated;
revoke all on function public.get_commerce_catalog() from public;
revoke all on function public.get_my_commerce_history() from public,anon;
revoke all on function public.get_my_commerce_inventory() from public,anon;
revoke all on function public.activate_consumable(text) from public,anon;
revoke all on function public.record_product_event(text,uuid,jsonb) from public;
revoke all on function public.process_stripe_event(text,text,uuid,text,text,text,integer,text,integer) from public,anon,authenticated;
revoke all on function public.get_commerce_admin_stats(integer) from public,anon;
revoke all on function public.detect_crossings_private(integer,integer) from public,anon,authenticated;
grant execute on function public.get_commerce_catalog() to anon,authenticated;
grant execute on function public.get_my_commerce_history() to authenticated;
grant execute on function public.get_my_commerce_inventory() to authenticated;
grant execute on function public.activate_consumable(text) to authenticated;
grant execute on function public.record_product_event(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.process_stripe_event(text,text,uuid,text,text,text,integer,text,integer) to service_role;
grant execute on function public.get_commerce_admin_stats(integer) to authenticated;
grant execute on function public.detect_crossings_private(integer,integer) to service_role;
