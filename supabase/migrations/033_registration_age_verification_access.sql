-- Restore the authenticated registration flow after production schema drift.
-- RLS remains the source of row visibility; these grants only allow policies
-- to be evaluated for the signed-in member.

grant select on public.users to authenticated;
grant select on public.age_verification_requests to authenticated;

create or replace function public.complete_profile_onboarding(
  p_display_name text,
  p_handle text,
  p_gender text,
  p_terms_version text,
  p_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_handle text;
  v_gender text;
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
    handle_changed_at = case
      when public.profiles.handle is distinct from excluded.handle then now()
      else public.profiles.handle_changed_at
    end,
    updated_at = now();

  update public.users set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    privacy_version = p_privacy_version,
    privacy_accepted_at = now()
  where id = v_user;
end;
$$;

revoke all on function public.complete_profile_onboarding(text, text, text, text, text) from public, anon;
grant execute on function public.complete_profile_onboarding(text, text, text, text, text) to authenticated;
