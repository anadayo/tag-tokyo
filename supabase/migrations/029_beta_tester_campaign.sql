-- TAG TOKYO beta tester campaign.
-- The first 300 confirmed auth accounts receive one permanent title and one
-- consumable BOOST. Allocation is serialized and idempotent.

alter table public.users
  add column if not exists beta_tester boolean not null default false,
  add column if not exists beta_tester_number smallint,
  add column if not exists beta_joined_at timestamptz,
  add column if not exists beta_reward_claimed boolean not null default false,
  add column if not exists beta_boost_granted boolean not null default false,
  add column if not exists beta_title_owned boolean not null default false;

alter table public.users drop constraint if exists users_beta_tester_number_check;
alter table public.users add constraint users_beta_tester_number_check
  check (beta_tester_number is null or beta_tester_number between 1 and 300);

create unique index if not exists users_beta_tester_number_unique
  on public.users(beta_tester_number) where beta_tester_number is not null;

insert into public.cosmetics(id,name,kind,exp_cost,rarity,active)
values('title-beta-tester','β TESTER','title',null,'rare',true)
on conflict(id) do update set name=excluded.name,kind=excluded.kind,exp_cost=excluded.exp_cost,rarity=excluded.rarity,active=true;

create table if not exists public.user_consumables(
  user_id uuid not null references public.users(id) on delete cascade,
  item_key text not null check(item_key in('beta-boost')),
  quantity integer not null default 0 check(quantity between 0 and 99),
  updated_at timestamptz not null default now(),
  primary key(user_id,item_key)
);

create table if not exists public.active_boosts(
  user_id uuid primary key references public.users(id) on delete cascade,
  item_key text not null check(item_key='beta-boost'),
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check(expires_at>activated_at and expires_at<=activated_at+interval '31 minutes')
);

alter table public.user_consumables enable row level security;
alter table public.active_boosts enable row level security;

drop policy if exists reports_moderator_read on public.reports;
create policy reports_moderator_read on public.reports for select using(public.is_moderator());

drop policy if exists user_consumables_self_read on public.user_consumables;
create policy user_consumables_self_read on public.user_consumables for select
  using(user_id=public.current_app_user_id());
drop policy if exists active_boosts_self_read on public.active_boosts;
create policy active_boosts_self_read on public.active_boosts for select
  using(user_id=public.current_app_user_id());

create or replace function public.award_beta_tester_for_auth(
  p_auth_user uuid,p_email text,p_confirmed_at timestamptz
) returns smallint language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_number smallint;v_count integer;
begin
  if p_auth_user is null or p_confirmed_at is null then return null;end if;
  perform pg_advisory_xact_lock(hashtextextended('tag-tokyo-beta-300',0));

  insert into public.users(auth_user_id,email)
    values(p_auth_user,p_email)
    on conflict(auth_user_id) do update set email=excluded.email
    returning id,beta_tester_number into v_user,v_number;
  if v_number is not null then return v_number;end if;

  select count(*)::integer into v_count from public.users where beta_tester;
  if v_count>=300 then return null;end if;
  select (coalesce(max(beta_tester_number),0)+1)::smallint into v_number
    from public.users where beta_tester_number is not null;
  if v_number>300 then return null;end if;

  insert into public.user_cosmetics(user_id,cosmetic_id,source)
    values(v_user,'title-beta-tester','beta_tester') on conflict do nothing;
  insert into public.user_consumables(user_id,item_key,quantity)
    values(v_user,'beta-boost',1)
    on conflict(user_id,item_key) do update set
      quantity=greatest(public.user_consumables.quantity,1),updated_at=now();
  update public.users set
    beta_tester=true,
    beta_tester_number=v_number,
    beta_joined_at=p_confirmed_at,
    beta_reward_claimed=true,
    beta_boost_granted=true,
    beta_title_owned=true
  where id=v_user;
  return v_number;
end $$;

create or replace function public.handle_beta_email_confirmation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email_confirmed_at is not null and (tg_op='INSERT' or old.email_confirmed_at is null) then
    perform public.award_beta_tester_for_auth(new.id,new.email,new.email_confirmed_at);
  end if;
  return new;
end $$;

drop trigger if exists auth_beta_email_confirmed on auth.users;
create trigger auth_beta_email_confirmed
after insert or update of email_confirmed_at on auth.users
for each row execute function public.handle_beta_email_confirmation();

-- Existing confirmed accounts are assigned by their actual confirmation time.
do $$
declare account record;
begin
  for account in
    select id,email,email_confirmed_at from auth.users
    where email_confirmed_at is not null
    order by email_confirmed_at,id
  loop
    perform public.award_beta_tester_for_auth(account.id,account.email,account.email_confirmed_at);
  end loop;
end $$;

create or replace function public.get_beta_campaign_status()
returns table(
  claimed_count integer,remaining_count integer,campaign_open boolean,
  is_beta_tester boolean,beta_tester_number smallint,reward_claimed boolean,
  boost_quantity integer,boost_active_until timestamptz
) language sql stable security definer set search_path=public as $$
  with me as(select public.current_app_user_id() user_id), totals as(
    select count(*)::integer claimed from public.users where beta_tester
  )
  select totals.claimed,greatest(0,300-totals.claimed),totals.claimed<300,
    coalesce(u.beta_tester,false),u.beta_tester_number,coalesce(u.beta_reward_claimed,false),
    coalesce(c.quantity,0),case when b.expires_at>now() then b.expires_at else null end
  from totals cross join me
  left join public.users u on u.id=me.user_id
  left join public.user_consumables c on c.user_id=u.id and c.item_key='beta-boost'
  left join public.active_boosts b on b.user_id=u.id and b.item_key='beta-boost'
$$;

create or replace function public.activate_beta_boost()
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_expires timestamptz;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  if not public.live_community_status() then raise exception 'live community is not enabled';end if;
  if exists(select 1 from public.active_boosts where user_id=v_user and expires_at>now()) then
    raise exception 'boost already active';
  end if;
  update public.user_consumables set quantity=quantity-1,updated_at=now()
    where user_id=v_user and item_key='beta-boost' and quantity>0;
  if not found then raise exception 'boost unavailable';end if;
  v_expires:=now()+interval '30 minutes';
  insert into public.active_boosts(user_id,item_key,activated_at,expires_at)
    values(v_user,'beta-boost',now(),v_expires)
    on conflict(user_id) do update set item_key=excluded.item_key,activated_at=excluded.activated_at,expires_at=excluded.expires_at;
  return v_expires;
end $$;

create or replace function public.get_beta_admin_stats()
returns table(
  registered_users bigint,confirmed_emails bigint,beta_testers bigint,
  remaining_slots integer,dau bigint,active_matches bigint,open_reports bigint
) language plpgsql stable security definer set search_path=public,auth as $$
begin
  if not public.is_moderator() then raise exception 'moderator access required';end if;
  return query select
    (select count(*) from public.users where not is_demo),
    (select count(*) from auth.users where email_confirmed_at is not null),
    (select count(*) from public.users where beta_tester),
    greatest(0,300-(select count(*)::integer from public.users where beta_tester)),
    (select count(*) from public.users where not is_demo and last_seen_at>now()-interval '24 hours'),
    (select count(*) from public.matches where ended_at is null),
    (select count(*) from public.reports where status='open');
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
    join public.profiles pa on pa.user_id=sa.user_id join public.profiles pb on pb.user_id=sb.user_id
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and abs(extract(epoch from(la.captured_at-lb.captured_at)))<=180
      and((pa.gender='man' and pb.gender='woman')or(pa.gender='woman' and pb.gender='man'))
      and public.distance_meters(la.latitude,la.longitude,lb.latitude,lb.longitude)<=
        least(greatest(p_radius_meters,100),1000)*case when exists(
          select 1 from public.active_boosts ab where ab.user_id in(sa.user_id,sb.user_id) and ab.expires_at>now()
        ) then 1.5 else 1 end
      and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as(
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('minute',crossed_at) from candidate_pairs on conflict do nothing returning 1
  )select count(*) into created_count from inserted;
  return created_count;
end $$;

revoke all on public.user_consumables from anon,authenticated;
revoke all on public.active_boosts from anon,authenticated;
grant select on public.user_consumables to authenticated;
grant select on public.active_boosts to authenticated;

revoke all on function public.award_beta_tester_for_auth(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.get_beta_campaign_status() from public;
revoke all on function public.activate_beta_boost() from public,anon;
revoke all on function public.get_beta_admin_stats() from public,anon;
revoke all on function public.detect_crossings_private(integer,integer) from public,anon,authenticated;
grant execute on function public.get_beta_campaign_status() to anon,authenticated;
grant execute on function public.activate_beta_boost() to authenticated;
grant execute on function public.get_beta_admin_stats() to authenticated;
grant execute on function public.detect_crossings_private(integer,integer) to service_role;
