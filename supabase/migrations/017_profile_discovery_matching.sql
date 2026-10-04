-- Real-user profile discovery with mutual-like matching.
-- Candidates must be active, non-demo, consented and manually age verified.

alter table public.matches alter column crossing_id drop not null;

create unique index if not exists matches_discovery_pair_unique
  on public.matches (user_a, user_b)
  where crossing_id is null;

create table if not exists public.discovery_likes (
  sender_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, receiver_id),
  constraint discovery_like_distinct_users check (sender_id <> receiver_id)
);

alter table public.discovery_likes enable row level security;

drop policy if exists discovery_likes_sender_read on public.discovery_likes;
create policy discovery_likes_sender_read on public.discovery_likes for select using (
  sender_id = public.current_app_user_id()
);

create index if not exists discovery_likes_sender_created_idx
  on public.discovery_likes (sender_id, created_at desc);

create or replace function public.get_discovery_profiles(p_limit integer default 24)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  avatar_url text,
  is_official boolean,
  liked boolean
) language plpgsql stable security definer set search_path = public as $$
declare v_viewer uuid; v_gender text;
begin
  v_viewer := public.current_app_user_id();
  perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id = v_viewer;

  return query
  select
    p.user_id,
    p.display_name,
    p.handle,
    p.bio,
    p.avatar_url,
    (u.role = 'owner') as is_official,
    exists (
      select 1 from public.discovery_likes dl
      where dl.sender_id = v_viewer and dl.receiver_id = u.id
    ) as liked
  from public.users u
  join public.profiles p on p.user_id = u.id
  where u.id <> v_viewer
    and u.status = 'active'
    and not u.is_demo
    and u.age_verified
    and u.age_verification_status = 'verified'
    and u.terms_accepted_at is not null
    and u.privacy_accepted_at is not null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = v_viewer and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = v_viewer)
    )
    and not exists (
      select 1 from public.matches m
      where v_viewer in (m.user_a, m.user_b) and u.id in (m.user_a, m.user_b)
    )
  order by
    case when v_gender = 'woman' and u.role = 'owner' then 0 else 1 end,
    p.updated_at desc,
    u.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
end $$;

create or replace function public.send_profile_like(p_receiver uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_sender uuid; v_matched boolean := false;
begin
  v_sender := public.current_app_user_id();
  perform public.assert_live_member(v_sender);
  if p_receiver is null or p_receiver = v_sender then raise exception 'invalid profile'; end if;
  perform public.assert_live_member(p_receiver);

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_sender and b.blocked_id = p_receiver)
       or (b.blocker_id = p_receiver and b.blocked_id = v_sender)
  ) then raise exception 'profile unavailable'; end if;

  if (
    select count(*) from public.discovery_likes dl
    where dl.sender_id = v_sender and dl.created_at > now() - interval '24 hours'
  ) >= 50 then raise exception 'daily like limit reached'; end if;

  insert into public.discovery_likes (sender_id, receiver_id)
  values (v_sender, p_receiver)
  on conflict do nothing;

  if exists (
    select 1 from public.discovery_likes dl
    where dl.sender_id = p_receiver and dl.receiver_id = v_sender
  ) then
    insert into public.matches (user_a, user_b, crossing_id)
    values (least(v_sender, p_receiver), greatest(v_sender, p_receiver), null)
    on conflict (user_a, user_b) where crossing_id is null do nothing;
    v_matched := true;
  end if;

  return v_matched;
end $$;

revoke insert, update, delete on public.discovery_likes from authenticated;
revoke all on function public.get_discovery_profiles(integer) from public, anon;
revoke all on function public.send_profile_like(uuid) from public, anon;
grant execute on function public.get_discovery_profiles(integer) to authenticated;
grant execute on function public.send_profile_like(uuid) to authenticated;
