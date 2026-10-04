-- Show one real, verified owner as an explicitly labelled official welcome profile.
-- No fabricated user, crossing, match, or recommendation row is created.

update public.profiles
set gender = 'unspecified'
where gender is null or gender not in ('woman', 'man', 'nonbinary', 'unspecified');

alter table public.profiles
  alter column gender set default 'unspecified',
  alter column gender set not null;

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender in ('woman', 'man', 'nonbinary', 'unspecified'));

create or replace function public.complete_profile_onboarding(
  p_display_name text,
  p_handle text,
  p_gender text,
  p_terms_version text,
  p_privacy_version text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_handle text; v_gender text;
begin
  v_user := public.current_app_user_id();
  v_handle := lower(trim(p_handle));
  v_gender := coalesce(nullif(trim(p_gender), ''), 'unspecified');
  if v_user is null then raise exception 'authenticated user required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 50 then raise exception 'invalid display name'; end if;
  if v_handle !~ '^[a-z0-9_]{5,15}$' then raise exception 'invalid handle'; end if;
  if v_gender not in ('woman', 'man', 'nonbinary', 'unspecified') then raise exception 'invalid gender'; end if;
  if coalesce(trim(p_terms_version), '') = '' or coalesce(trim(p_privacy_version), '') = '' then
    raise exception 'terms and privacy consent required';
  end if;

  insert into public.profiles (user_id, display_name, handle, gender, handle_changed_at)
    values (v_user, trim(p_display_name), v_handle, v_gender, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    handle = excluded.handle,
    gender = excluded.gender,
    handle_changed_at = case when public.profiles.handle is distinct from excluded.handle then now() else public.profiles.handle_changed_at end,
    updated_at = now();

  update public.users set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    privacy_version = p_privacy_version,
    privacy_accepted_at = now()
  where id = v_user;
end $$;

create or replace function public.update_member_profile(
  p_display_name text,
  p_handle text,
  p_bio text,
  p_gender text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_handle text; v_gender text;
begin
  v_user := public.current_app_user_id();
  v_handle := lower(trim(p_handle));
  v_gender := coalesce(nullif(trim(p_gender), ''), 'unspecified');
  if v_user is null then raise exception 'authenticated user required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 50 then raise exception 'invalid display name'; end if;
  if char_length(coalesce(p_bio, '')) > 500 then raise exception 'bio too long'; end if;
  if v_handle !~ '^[a-z0-9_]{5,15}$' then raise exception 'invalid handle'; end if;
  if v_gender not in ('woman', 'man', 'nonbinary', 'unspecified') then raise exception 'invalid gender'; end if;

  insert into public.profiles (user_id, display_name, handle, bio, gender, handle_changed_at)
    values (v_user, trim(p_display_name), v_handle, coalesce(p_bio, ''), v_gender, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    handle = excluded.handle,
    bio = excluded.bio,
    gender = excluded.gender,
    handle_changed_at = case when public.profiles.handle is distinct from excluded.handle then now() else public.profiles.handle_changed_at end,
    updated_at = now();
end $$;

create or replace function public.get_visible_member_profiles(p_user_ids uuid[])
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  avatar_url text,
  is_official boolean
) language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.handle, p.bio, p.avatar_url, (u.role = 'owner') as is_official
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.user_id = any(coalesce(p_user_ids, array[]::uuid[]))
    and u.status = 'active'
    and not u.is_demo
    and (
      p.user_id = public.current_app_user_id()
      or exists (
        select 1 from public.crossings c
        where c.expires_at > now()
          and public.current_app_user_id() in (c.user_a, c.user_b)
          and p.user_id in (c.user_a, c.user_b)
      )
      or exists (
        select 1 from public.matches m
        where public.current_app_user_id() in (m.user_a, m.user_b)
          and p.user_id in (m.user_a, m.user_b)
      )
    )
$$;

create or replace function public.get_official_welcome_profile()
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  avatar_url text
) language sql stable security definer set search_path = public as $$
  with viewer as (
    select u.id
    from public.users u
    join public.profiles p on p.user_id = u.id
    where u.id = public.current_app_user_id()
      and u.status = 'active'
      and not u.is_demo
      and p.gender = 'woman'
  )
  select p.user_id, p.display_name, p.handle, p.bio, p.avatar_url
  from public.users u
  join public.profiles p on p.user_id = u.id
  cross join viewer v
  where u.role = 'owner'
    and u.id <> v.id
    and u.status = 'active'
    and not u.is_demo
    and u.age_verified
    and u.age_verification_status = 'verified'
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = v.id and b.blocked_id = u.id)
         or (b.blocker_id = u.id and b.blocked_id = v.id)
    )
  order by u.created_at asc
  limit 1
$$;

revoke all on function public.complete_profile_onboarding(text, text, text, text, text) from public, anon;
revoke all on function public.update_member_profile(text, text, text, text) from public, anon;
revoke all on function public.get_visible_member_profiles(uuid[]) from public, anon;
revoke all on function public.get_official_welcome_profile() from public, anon;

grant execute on function public.complete_profile_onboarding(text, text, text, text, text) to authenticated;
grant execute on function public.update_member_profile(text, text, text, text) to authenticated;
grant execute on function public.get_visible_member_profiles(uuid[]) to authenticated;
grant execute on function public.get_official_welcome_profile() to authenticated;
