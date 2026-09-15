-- TAG TOKYO v0.3: profile growth, spendable EXP, cosmetics, areas and free TAG SPOT draws.
-- EXP is never purchasable here. Rewards are server-issued and every spot draw wins something.

alter table public.profiles
  add column if not exists total_earned_exp bigint not null default 0 check (total_earned_exp >= 0),
  add column if not exists available_exp bigint not null default 0 check (available_exp >= 0),
  add column if not exists profile_level smallint not null default 1 check (profile_level between 1 and 12),
  add column if not exists equipped_frame text,
  add column if not exists equipped_background text,
  add column if not exists equipped_title text;

create table public.exp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null check (reason in (
    'crossing','tag_spot','mission','event','achievement','area_contribution','cosmetic_exchange','admin_adjustment'
  )),
  reference_type text,
  reference_id text,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create table public.profile_unlocks (
  key text primary key,
  label text not null,
  required_level smallint not null check (required_level between 1 and 12),
  sort_order smallint not null
);

insert into public.profile_unlocks (key,label,required_level,sort_order) values
  ('basic','基本プロフィール',1,10),
  ('weekend','休日の過ごし方',3,20),
  ('romance_contact','恋愛観・連絡頻度',5,30),
  ('values_lifestyle','価値観・生活スタイル',7,40),
  ('work_money','仕事・お金の使い方',9,50),
  ('marriage_extra_bio','結婚観・自己紹介追加枠',11,60)
on conflict (key) do update set label=excluded.label, required_level=excluded.required_level, sort_order=excluded.sort_order;

create table public.cosmetics (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('frame','background','title','nameplate','seasonal','boost','super_boost')),
  exp_cost integer check (exp_cost is null or exp_cost >= 0),
  rarity text not null default 'normal' check (rarity in ('normal','rare','sr','ssr')),
  available_from timestamptz,
  available_until timestamptz,
  active boolean not null default true
);

insert into public.cosmetics (id,name,kind,exp_cost,rarity) values
  ('frame-mint','TOKYO MINT','frame',500,'normal'),
  ('frame-coral','CROSS CORAL','frame',800,'normal'),
  ('title-walker','東京ウォーカー','title',1000,'normal'),
  ('spot-rare','TAG SPOT限定装飾','seasonal',null,'rare'),
  ('spot-sr','BOOST','boost',null,'sr'),
  ('spot-ssr','SUPER BOOST','super_boost',null,'ssr')
on conflict (id) do update set name=excluded.name, kind=excluded.kind, exp_cost=excluded.exp_cost, rarity=excluded.rarity;

create table public.user_cosmetics (
  user_id uuid references public.users(id) on delete cascade,
  cosmetic_id text references public.cosmetics(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  source text not null,
  primary key (user_id, cosmetic_id)
);

create table public.areas (
  id text primary key,
  name text not null unique,
  map_x numeric(5,2) not null check (map_x between 0 and 100),
  map_y numeric(5,2) not null check (map_y between 0 and 100),
  latitude double precision not null check (latitude between 35.49 and 35.90),
  longitude double precision not null check (longitude between 138.94 and 139.93),
  contribution_radius_m integer not null default 1000 check (contribution_radius_m = 1000),
  active boolean not null default true
);

insert into public.areas (id,name,map_x,map_y,latitude,longitude) values
  ('kichijoji','吉祥寺',13,48,35.7033,139.5796),
  ('shinjuku','新宿',35,52,35.6938,139.7034),
  ('shibuya','渋谷',36,72,35.6580,139.7016),
  ('ikebukuro','池袋',42,30,35.7295,139.7109),
  ('ueno','上野',69,28,35.7141,139.7774),
  ('kitasenju','北千住',80,12,35.7497,139.8050)
on conflict (id) do update set name=excluded.name, map_x=excluded.map_x, map_y=excluded.map_y,
  latitude=excluded.latitude, longitude=excluded.longitude, contribution_radius_m=1000;

create table public.area_contributions (
  area_id text references public.areas(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  points bigint not null default 0 check (points >= 0),
  updated_at timestamptz not null default now(),
  primary key (area_id, user_id)
);

create table public.tag_spots (
  id text primary key,
  area_id text not null references public.areas(id) on delete cascade,
  name text not null,
  latitude double precision not null check (latitude between 35.49 and 35.90),
  longitude double precision not null check (longitude between 138.94 and 139.93),
  map_x numeric(5,2) not null check (map_x between 0 and 100),
  map_y numeric(5,2) not null check (map_y between 0 and 100),
  radius_m integer not null default 150 check (radius_m between 25 and 500),
  active boolean not null default true
);

insert into public.tag_spots (id,area_id,name,latitude,longitude,map_x,map_y) values
  ('spot-shibuya','shibuya','SHIBUYA TAG SPOT',35.6580,139.7016,49,77),
  ('spot-shinjuku','shinjuku','SHINJUKU TAG SPOT',35.6900,139.7005,27,40),
  ('spot-ueno','ueno','UENO TAG SPOT',35.7141,139.7774,78,38)
on conflict (id) do update set name=excluded.name, latitude=excluded.latitude, longitude=excluded.longitude, map_x=excluded.map_x, map_y=excluded.map_y;

create table public.tag_spot_draws (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  spot_id text not null references public.tag_spots(id) on delete cascade,
  draw_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  reward_type text not null check (reward_type in ('exp','cosmetic')),
  reward_key text not null,
  reward_exp integer not null default 0 check (reward_exp >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, spot_id, draw_date)
);

create index exp_ledger_user_created_idx on public.exp_ledger (user_id, created_at desc);
create index area_contributions_rank_idx on public.area_contributions (area_id, points desc, updated_at);
create index tag_spot_draws_user_date_idx on public.tag_spot_draws (user_id, draw_date desc);

create or replace function public.profile_level_for_exp(p_total bigint)
returns smallint language sql immutable as $$
  select case
    when p_total >= 6500 then 12 when p_total >= 5200 then 11 when p_total >= 4100 then 10
    when p_total >= 3200 then 9 when p_total >= 2500 then 8 when p_total >= 2000 then 7
    when p_total >= 1450 then 6 when p_total >= 1000 then 5 when p_total >= 600 then 4
    when p_total >= 300 then 3 when p_total >= 100 then 2 else 1 end::smallint
$$;

create or replace function public.issue_exp(
  p_user uuid, p_amount integer, p_reason text, p_reference_type text default null, p_reference_id text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_amount <= 0 or p_reason not in ('crossing','tag_spot','mission','event','achievement','admin_adjustment') then
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

create or replace function public.spend_exp(
  p_user uuid, p_amount integer, p_reason text, p_reference_type text, p_reference_id text
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_balance bigint;
begin
  if p_amount <= 0 or p_reason not in ('area_contribution','cosmetic_exchange') then raise exception 'invalid EXP spend'; end if;
  update public.profiles set available_exp = available_exp - p_amount, updated_at = now()
    where user_id = p_user and available_exp >= p_amount returning available_exp into v_balance;
  if v_balance is null then raise exception 'insufficient EXP'; end if;
  insert into public.exp_ledger (user_id,amount,reason,reference_type,reference_id,balance_after)
    values (p_user,-p_amount,p_reason,p_reference_type,p_reference_id,v_balance);
  return v_balance;
end $$;

create or replace function public.award_crossing_exp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where user_id=new.user_a) then
    perform public.issue_exp(new.user_a,5+floor(random()*6)::integer,'crossing','crossing',new.id::text);
  end if;
  if exists (select 1 from public.profiles where user_id=new.user_b) then
    perform public.issue_exp(new.user_b,5+floor(random()*6)::integer,'crossing','crossing',new.id::text);
  end if;
  return new;
end $$;
create trigger crossing_exp_after_insert after insert on public.crossings
for each row execute function public.award_crossing_exp();

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

create or replace function public.exchange_cosmetic(p_cosmetic_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_cost integer;
begin
  v_user := public.current_app_user_id();
  select exp_cost into v_cost from public.cosmetics where id=p_cosmetic_id and active and exp_cost is not null
    and (available_from is null or available_from <= now()) and (available_until is null or available_until > now());
  if v_user is null or v_cost is null then raise exception 'cosmetic unavailable'; end if;
  if exists (select 1 from public.user_cosmetics where user_id=v_user and cosmetic_id=p_cosmetic_id) then raise exception 'already owned'; end if;
  perform public.spend_exp(v_user,v_cost,'cosmetic_exchange','cosmetic',p_cosmetic_id);
  insert into public.user_cosmetics (user_id,cosmetic_id,source) values (v_user,p_cosmetic_id,'exp_exchange');
end $$;

create or replace function public.distance_meters(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(lat2-lat1)/2),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)))
$$;

create or replace function public.draw_tag_spot(p_spot_id text, p_latitude double precision, p_longitude double precision)
returns table(reward_type text, reward_key text, reward_exp integer) language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_spot public.tag_spots%rowtype; v_roll double precision; v_type text; v_key text; v_exp integer;
begin
  v_user := public.current_app_user_id();
  if not exists (select 1 from public.users where id=v_user and age_verified and birth_date <= current_date - interval '20 years' and not is_demo) then raise exception '20+ verified user required'; end if;
  select * into v_spot from public.tag_spots where id=p_spot_id and active;
  if v_spot.id is null then raise exception 'spot unavailable'; end if;
  if public.distance_meters(p_latitude,p_longitude,v_spot.latitude,v_spot.longitude) > v_spot.radius_m then raise exception 'move closer to TAG SPOT'; end if;
  if exists (select 1 from public.tag_spot_draws d where d.user_id=v_user and d.spot_id=p_spot_id and d.draw_date=(now() at time zone 'Asia/Tokyo')::date) then raise exception 'already drawn today'; end if;
  v_roll := random();
  if v_roll < 1.0/300 then v_type:='cosmetic'; v_key:='spot-ssr'; v_exp:=0;
  elsif v_roll < 1.0/80 then v_type:='cosmetic'; v_key:='spot-sr'; v_exp:=0;
  elsif v_roll < 1.0/25 then v_type:='cosmetic'; v_key:='spot-rare'; v_exp:=0;
  elsif v_roll < 0.12 then v_type:='exp'; v_key:='exp-100'; v_exp:=100;
  elsif v_roll < 0.37 then v_type:='exp'; v_key:='exp-50'; v_exp:=50;
  else v_type:='exp'; v_key:='exp-30'; v_exp:=30; end if;
  insert into public.tag_spot_draws (user_id,spot_id,reward_type,reward_key,reward_exp) values (v_user,p_spot_id,v_type,v_key,v_exp);
  if v_type='cosmetic' and exists (select 1 from public.user_cosmetics where user_id=v_user and cosmetic_id=v_key) then
    v_type:='exp'; v_key:='duplicate-compensation'; v_exp:=100;
    update public.tag_spot_draws set reward_type=v_type,reward_key=v_key,reward_exp=v_exp
      where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date;
  end if;
  if v_type='exp' then
    perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  else
    insert into public.user_cosmetics (user_id,cosmetic_id,source) values (v_user,v_key,'tag_spot') on conflict do nothing;
  end if;
  return query select v_type,v_key,v_exp;
end $$;

alter table public.exp_ledger enable row level security;
alter table public.profile_unlocks enable row level security;
alter table public.cosmetics enable row level security;
alter table public.user_cosmetics enable row level security;
alter table public.areas enable row level security;
alter table public.area_contributions enable row level security;
alter table public.tag_spots enable row level security;
alter table public.tag_spot_draws enable row level security;

create policy exp_ledger_self_read on public.exp_ledger for select using (user_id=public.current_app_user_id());
create policy profile_unlocks_read on public.profile_unlocks for select using (true);
create policy cosmetics_read on public.cosmetics for select using (active);
create policy user_cosmetics_self_read on public.user_cosmetics for select using (user_id=public.current_app_user_id());
create policy areas_read on public.areas for select using (active);
create policy area_contributions_self_read on public.area_contributions for select using (user_id=public.current_app_user_id());
create policy tag_spots_read on public.tag_spots for select using (active);
create policy tag_spot_draws_self_read on public.tag_spot_draws for select using (user_id=public.current_app_user_id());

revoke all on function public.issue_exp(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.spend_exp(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.award_crossing_exp() from public,anon,authenticated;
revoke all on function public.distance_meters(double precision,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.contribute_area_exp(text,integer,double precision,double precision) to authenticated;
grant execute on function public.exchange_cosmetic(text) to authenticated;
grant execute on function public.draw_tag_spot(text,double precision,double precision) to authenticated;
