-- Profile identity and consent for the live beta.
-- Email remains in Supabase Auth; this table stores consent metadata only.

alter table public.users
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_version text,
  add column if not exists privacy_accepted_at timestamptz;

alter table public.profiles
  add column if not exists handle text,
  add column if not exists handle_changed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_handle_format;

alter table public.profiles
  add constraint profiles_handle_format
  check (handle is null or handle ~ '^[A-Za-z0-9_]{5,15}$');

create unique index if not exists profiles_handle_lower_unique
  on public.profiles (lower(handle)) where handle is not null;

create or replace function public.complete_profile_onboarding(
  p_display_name text,
  p_handle text,
  p_terms_version text,
  p_privacy_version text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_handle text;
begin
  v_user := public.current_app_user_id();
  v_handle := lower(trim(p_handle));
  if v_user is null then raise exception 'authenticated user required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 50 then raise exception 'invalid display name'; end if;
  if v_handle !~ '^[a-z0-9_]{5,15}$' then raise exception 'invalid handle'; end if;
  if coalesce(trim(p_terms_version), '') = '' or coalesce(trim(p_privacy_version), '') = '' then
    raise exception 'terms and privacy consent required';
  end if;

  insert into public.profiles (user_id, display_name, handle, handle_changed_at)
    values (v_user, trim(p_display_name), v_handle, now())
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    handle = excluded.handle,
    handle_changed_at = case when public.profiles.handle is distinct from excluded.handle then now() else public.profiles.handle_changed_at end,
    updated_at = now();

  update public.users set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    privacy_version = p_privacy_version,
    privacy_accepted_at = now()
  where id = v_user;
end $$;

revoke all on function public.complete_profile_onboarding(text,text,text,text) from public, anon;
grant execute on function public.complete_profile_onboarding(text,text,text,text) to authenticated;
