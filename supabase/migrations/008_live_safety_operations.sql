-- TAG TOKYO live-beta safety boundary.
-- Apply this migration before configuring any age-verification provider or
-- enabling the live-community environment flag. It deliberately defaults off.

create type public.age_verification_status as enum (
  'not_started', 'pending', 'verified', 'rejected', 'expired'
);

create type public.report_status as enum (
  'open', 'in_review', 'actioned', 'closed'
);

alter table public.users
  add column if not exists age_verification_status public.age_verification_status not null default 'not_started',
  add column if not exists age_verified_at timestamptz,
  add column if not exists age_verification_method text,
  add column if not exists age_verification_reference text;

-- Never store document images or ID numbers in this application table.
alter table public.users
  add constraint users_verified_age_metadata
  check (
    age_verification_status <> 'verified'
    or (age_verified_at is not null and age_verification_method is not null and age_verification_reference is not null)
  );

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('member', 'moderator', 'owner'));

alter table public.reports
  add column if not exists status public.report_status not null default 'open',
  add column if not exists priority smallint not null default 2 check (priority between 1 and 4),
  add column if not exists assigned_to uuid references public.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolution text check (resolution is null or char_length(resolution) <= 1000);

create table if not exists public.report_actions (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  action text not null check (action in ('assigned', 'warned', 'paused', 'restored', 'closed', 'escalated')),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'cancelled')),
  completed_at timestamptz,
  operator_note text not null default '' check (char_length(operator_note) <= 1000)
);

create table if not exists public.live_launch_controls (
  singleton boolean primary key default true check (singleton),
  live_interactions_enabled boolean not null default false,
  last_reviewed_at timestamptz,
  reviewed_by uuid references public.users(id),
  notes text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.live_launch_controls (singleton) values (true) on conflict do nothing;

create index if not exists reports_status_created_idx on public.reports (status, priority desc, created_at);
create index if not exists report_actions_report_created_idx on public.report_actions (report_id, created_at);

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and status = 'active' and role in ('moderator', 'owner')
  )
$$;

create or replace function public.live_community_is_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select live_interactions_enabled from public.live_launch_controls where singleton), false)
$$;

create or replace function public.assert_live_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.live_community_is_enabled() then
    raise exception 'live community is not enabled';
  end if;
  if not exists (
    select 1 from public.users
    where id = p_user_id
      and status = 'active'
      and not is_demo
      and age_verified
      and age_verification_status = 'verified'
      and terms_accepted_at is not null
      and privacy_accepted_at is not null
  ) then
    raise exception 'verified live member required';
  end if;
end $$;

create or replace function public.guard_live_tag_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_live_member(new.user_id);
  return new;
end $$;

create or replace function public.guard_live_like()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_live_member(new.sender_id);
  return new;
end $$;

create or replace function public.guard_live_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_live_member(new.sender_id);
  return new;
end $$;

create or replace function public.guard_live_area_contribution()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_live_member(new.user_id);
  return new;
end $$;

create or replace function public.guard_live_tag_spot_draw()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_live_member(new.user_id);
  return new;
end $$;

drop trigger if exists tag_sessions_live_guard on public.tag_sessions;
create trigger tag_sessions_live_guard before insert on public.tag_sessions
for each row execute function public.guard_live_tag_session();

drop trigger if exists likes_live_guard on public.likes;
create trigger likes_live_guard before insert on public.likes
for each row execute function public.guard_live_like();

drop trigger if exists messages_live_guard on public.messages;
create trigger messages_live_guard before insert on public.messages
for each row execute function public.guard_live_message();

drop trigger if exists area_contributions_live_guard on public.area_contributions;
create trigger area_contributions_live_guard before insert or update on public.area_contributions
for each row execute function public.guard_live_area_contribution();

drop trigger if exists tag_spot_draws_live_guard on public.tag_spot_draws;
create trigger tag_spot_draws_live_guard before insert on public.tag_spot_draws
for each row execute function public.guard_live_tag_spot_draw();

create or replace function public.request_account_deletion()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  v_user := public.current_app_user_id();
  if v_user is null then raise exception 'authenticated user required'; end if;
  insert into public.account_deletion_requests (user_id) values (v_user)
  on conflict (user_id) do update set requested_at = now(), status = 'requested', completed_at = null, operator_note = '';
end $$;

create or replace function public.review_report(
  p_report_id bigint,
  p_status public.report_status,
  p_action text,
  p_note text default '',
  p_pause_reported_user boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_reported uuid;
begin
  if not public.is_moderator() then raise exception 'moderator access required'; end if;
  select id into v_actor from public.users where auth_user_id = auth.uid();
  select reported_id into v_reported from public.reports where id = p_report_id for update;
  if v_reported is null then raise exception 'report not found'; end if;
  update public.reports set status = p_status, assigned_to = v_actor, reviewed_at = now(), resolution = left(p_note, 1000)
    where id = p_report_id;
  if p_pause_reported_user then
    update public.users set status = 'paused' where id = v_reported;
  end if;
  insert into public.report_actions (report_id, actor_id, action, note)
    values (p_report_id, v_actor, p_action, left(p_note, 1000));
end $$;

alter table public.report_actions enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.live_launch_controls enable row level security;

create policy report_actions_moderator_read on public.report_actions for select using (public.is_moderator());
create policy deletion_requests_self_read on public.account_deletion_requests for select using (user_id = public.current_app_user_id());
create policy deletion_requests_moderator_read on public.account_deletion_requests for select using (public.is_moderator());
create policy launch_controls_owner_read on public.live_launch_controls for select using (public.is_moderator());

-- Private profile-photo storage; this is intentionally not wired to the preview.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy profile_photos_owner_read on storage.objects for select using (
  bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy profile_photos_owner_insert on storage.objects for insert with check (
  bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy profile_photos_owner_update on storage.objects for update using (
  bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy profile_photos_owner_delete on storage.objects for delete using (
  bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text
);

revoke all on function public.is_moderator() from public, anon;
revoke all on function public.live_community_is_enabled() from public, anon;
revoke all on function public.assert_live_member(uuid) from public, anon, authenticated;
revoke all on function public.guard_live_tag_session() from public, anon, authenticated;
revoke all on function public.guard_live_like() from public, anon, authenticated;
revoke all on function public.guard_live_message() from public, anon, authenticated;
revoke all on function public.guard_live_area_contribution() from public, anon, authenticated;
revoke all on function public.guard_live_tag_spot_draw() from public, anon, authenticated;
revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.review_report(bigint, public.report_status, text, text, boolean) from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.review_report(bigint, public.report_status, text, text, boolean) to authenticated;
