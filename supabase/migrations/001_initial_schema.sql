create extension if not exists pgcrypto;

create type public.user_status as enum ('active', 'paused', 'deleted');
create type public.tag_session_status as enum ('active', 'expired', 'stopped');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text,
  birth_date date,
  age_verified boolean not null default false,
  status public.user_status not null default 'active',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint demo_has_no_auth check (not is_demo or auth_user_id is null)
);

create table public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_url text,
  gender text,
  interested_in text,
  activity_area text,
  occupation text,
  height_cm smallint,
  relationship_goal text,
  updated_at timestamptz not null default now()
);

create table public.tags (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table public.user_tags (
  user_id uuid references public.users(id) on delete cascade,
  tag_id bigint references public.tags(id) on delete cascade,
  primary key (user_id, tag_id)
);

create table public.tag_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.tag_session_status not null default 'active',
  constraint valid_session_length check (expires_at > started_at and expires_at <= started_at + interval '3 hours 1 minute')
);

create table public.location_samples (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.tag_sessions(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geohash text,
  created_at timestamptz not null default now(),
  delete_at timestamptz not null check (delete_at <= created_at + interval '24 hours 5 minutes')
);

create table public.crossings (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  area_label text not null,
  crossed_at timestamptz not null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  constraint crossing_distinct_users check (user_a <> user_b),
  unique (user_a, user_b, crossed_at)
);

create table public.likes (
  sender_id uuid references public.users(id) on delete cascade,
  receiver_id uuid references public.users(id) on delete cascade,
  crossing_id uuid references public.crossings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, receiver_id, crossing_id),
  constraint like_distinct_users check (sender_id <> receiver_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  crossing_id uuid not null references public.crossings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b, crossing_id),
  constraint match_distinct_users check (user_a <> user_b)
);

create table public.messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid references public.users(id) on delete cascade,
  blocked_id uuid references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint block_distinct_users check (blocker_id <> blocked_id)
);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  detail text not null default '' check (char_length(detail) <= 1000),
  created_at timestamptz not null default now(),
  constraint report_distinct_users check (reporter_id <> reported_id)
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values ('demo_profile_ratio', '{"ratio":1,"enabled":true}');
insert into public.tags (name) values
  ('音楽'),('ゲーム'),('ラーメン'),('古着'),('カフェ'),('お笑い'),('映画'),('アニメ'),
  ('旅行'),('美術館'),('サウナ'),('スポーツ'),('カードゲーム'),('読書'),('散歩'),('居酒屋')
on conflict do nothing;

create index tag_sessions_active_idx on public.tag_sessions (status, expires_at);
create index location_samples_session_created_idx on public.location_samples (session_id, created_at);
create index location_samples_delete_idx on public.location_samples (delete_at);
create index crossings_users_idx on public.crossings (user_a, user_b, expires_at);
create index messages_match_created_idx on public.messages (match_id, created_at);

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.users where auth_user_id = auth.uid() and status = 'active' limit 1 $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (auth_user_id, email) values (new.id, new.email)
  on conflict (auth_user_id) do update set email = excluded.email;
  return new;
end $$;
create trigger auth_user_created after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.start_tag_session(
  p_latitude double precision,
  p_longitude double precision,
  p_duration_minutes integer,
  p_delete_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_session uuid;
begin
  select id into v_user from public.users
    where auth_user_id = auth.uid() and age_verified and status = 'active' and not is_demo;
  if v_user is null then raise exception 'age verification required'; end if;
  if p_duration_minutes not in (30, 60, 180) then raise exception 'invalid duration'; end if;
  if p_latitude < 35.49 or p_latitude > 35.90 or p_longitude < 138.94 or p_longitude > 139.93 then
    raise exception 'TAG ON is available only in Tokyo';
  end if;
  update public.tag_sessions set status = 'stopped'
    where user_id = v_user and status = 'active';
  insert into public.tag_sessions (user_id, expires_at)
    values (v_user, now() + make_interval(mins => p_duration_minutes)) returning id into v_session;
  insert into public.location_samples (session_id, latitude, longitude, delete_at)
    values (v_session, p_latitude, p_longitude, least(p_delete_at, now() + interval '24 hours'));
  return v_session;
end $$;

create or replace function public.stop_tag_session()
returns void language sql security definer set search_path = public as $$
  update public.tag_sessions set status = 'stopped'
  where user_id = public.current_app_user_id() and status = 'active'
$$;

create or replace function public.guard_demo_interactions()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.users where id in (new.sender_id, new.receiver_id) and is_demo) then
    raise exception 'demo profiles cannot receive or send TAGs';
  end if;
  return new;
end $$;
create trigger likes_no_demo before insert on public.likes for each row execute function public.guard_demo_interactions();

create or replace function public.create_match_after_mutual_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.likes
    where sender_id = new.receiver_id and receiver_id = new.sender_id and crossing_id = new.crossing_id
  ) then
    insert into public.matches (user_a, user_b, crossing_id)
    values (least(new.sender_id, new.receiver_id), greatest(new.sender_id, new.receiver_id), new.crossing_id)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger mutual_tag_match after insert on public.likes for each row execute function public.create_match_after_mutual_tag();

create or replace function public.cleanup_expired_private_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.location_samples where delete_at <= now();
  delete from public.crossings where expires_at <= now();
  update public.tag_sessions set status = 'expired' where status = 'active' and expires_at <= now();
end $$;

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.tags enable row level security;
alter table public.user_tags enable row level security;
alter table public.tag_sessions enable row level security;
alter table public.location_samples enable row level security;
alter table public.crossings enable row level security;
alter table public.likes enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;

create policy users_self_read on public.users for select using (id = public.current_app_user_id());
create policy profiles_visible_connections on public.profiles for select using (
  user_id = public.current_app_user_id()
  or exists (select 1 from public.users u where u.id = user_id and u.is_demo)
  or exists (select 1 from public.crossings c where c.expires_at > now() and public.current_app_user_id() in (c.user_a,c.user_b) and user_id in (c.user_a,c.user_b))
  or exists (select 1 from public.matches m where public.current_app_user_id() in (m.user_a,m.user_b) and user_id in (m.user_a,m.user_b))
);
create policy profiles_self_write on public.profiles for all using (user_id = public.current_app_user_id()) with check (user_id = public.current_app_user_id());
create policy tags_read on public.tags for select using (true);
create policy user_tags_visible on public.user_tags for select using (
  user_id = public.current_app_user_id()
  or exists (select 1 from public.users u where u.id = user_id and u.is_demo)
  or exists (select 1 from public.crossings c where public.current_app_user_id() in (c.user_a,c.user_b) and user_id in (c.user_a,c.user_b))
);
create policy user_tags_self_write on public.user_tags for all using (user_id = public.current_app_user_id()) with check (user_id = public.current_app_user_id());
create policy sessions_self_read on public.tag_sessions for select using (user_id = public.current_app_user_id());
create policy crossings_participant_read on public.crossings for select using (public.current_app_user_id() in (user_a,user_b));
create policy likes_participant_read on public.likes for select using (public.current_app_user_id() in (sender_id,receiver_id));
create policy likes_sender_insert on public.likes for insert with check (
  sender_id = public.current_app_user_id()
  and exists (select 1 from public.crossings c where c.id = crossing_id and c.expires_at > now() and sender_id in (c.user_a,c.user_b) and receiver_id in (c.user_a,c.user_b))
  and not exists (select 1 from public.blocks b where (b.blocker_id,b.blocked_id) in ((sender_id,receiver_id),(receiver_id,sender_id)))
);
create policy matches_participant_read on public.matches for select using (public.current_app_user_id() in (user_a,user_b));
create policy messages_match_read on public.messages for select using (
  exists (select 1 from public.matches m where m.id = match_id and public.current_app_user_id() in (m.user_a,m.user_b))
);
create policy messages_match_insert on public.messages for insert with check (
  sender_id = public.current_app_user_id()
  and exists (select 1 from public.matches m where m.id = match_id and sender_id in (m.user_a,m.user_b))
  and not exists (select 1 from public.blocks b join public.matches m on m.id = match_id where (b.blocker_id,b.blocked_id) in ((m.user_a,m.user_b),(m.user_b,m.user_a)))
);
create policy blocks_self_manage on public.blocks for all using (blocker_id = public.current_app_user_id()) with check (blocker_id = public.current_app_user_id());
create policy reports_self_insert on public.reports for insert with check (reporter_id = public.current_app_user_id());
create policy reports_self_read on public.reports for select using (reporter_id = public.current_app_user_id());
create policy public_demo_setting on public.app_settings for select using (key = 'demo_profile_ratio');

revoke all on public.location_samples from anon, authenticated;
revoke all on function public.cleanup_expired_private_data() from public, anon, authenticated;
grant execute on function public.start_tag_session(double precision,double precision,integer,timestamptz) to authenticated;
grant execute on function public.stop_tag_session() to authenticated;
