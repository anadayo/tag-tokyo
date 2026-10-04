-- Persist every authenticated member's profile, photo and equipped cosmetics.
-- Anonymous preview state remains device-local and is never trusted for EXP.

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'profile-photos';

create or replace function public.update_member_profile_v2(
  p_display_name text,
  p_handle text,
  p_bio text,
  p_gender text,
  p_weekend text,
  p_romance_view text,
  p_contact_frequency text,
  p_values_detail text,
  p_lifestyle text,
  p_work_detail text,
  p_money_style text,
  p_marriage_view text,
  p_extra_bio text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_handle text;
  v_gender text;
  v_level smallint;
  v_owner boolean;
begin
  v_user := public.current_app_user_id();
  v_handle := lower(trim(p_handle));
  v_gender := coalesce(nullif(trim(p_gender), ''), 'unspecified');
  if v_user is null then raise exception 'authenticated user required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 50 then raise exception 'invalid display name'; end if;
  if char_length(coalesce(p_bio, '')) > 500 or char_length(coalesce(p_extra_bio, '')) > 500 then raise exception 'profile text too long'; end if;
  if greatest(
    char_length(coalesce(p_weekend, '')), char_length(coalesce(p_romance_view, '')),
    char_length(coalesce(p_contact_frequency, '')), char_length(coalesce(p_values_detail, '')),
    char_length(coalesce(p_lifestyle, '')), char_length(coalesce(p_work_detail, '')),
    char_length(coalesce(p_money_style, '')), char_length(coalesce(p_marriage_view, ''))
  ) > 160 then raise exception 'profile text too long'; end if;
  if v_handle !~ '^[a-z0-9_]{5,15}$' then raise exception 'invalid handle'; end if;
  if v_gender not in ('woman', 'man', 'nonbinary', 'unspecified') then raise exception 'invalid gender'; end if;

  select p.profile_level, (u.role = 'owner') into v_level, v_owner
  from public.profiles p join public.users u on u.id = p.user_id
  where p.user_id = v_user;
  if v_level is null then raise exception 'profile not found'; end if;

  update public.profiles set
    display_name = trim(p_display_name),
    handle = v_handle,
    bio = coalesce(p_bio, ''),
    gender = v_gender,
    weekend = case when v_owner or v_level >= 3 then coalesce(p_weekend, '') else weekend end,
    romance_view = case when v_owner or v_level >= 5 then coalesce(p_romance_view, '') else romance_view end,
    contact_frequency = case when v_owner or v_level >= 5 then coalesce(p_contact_frequency, '') else contact_frequency end,
    values_detail = case when v_owner or v_level >= 7 then coalesce(p_values_detail, '') else values_detail end,
    lifestyle = case when v_owner or v_level >= 7 then coalesce(p_lifestyle, '') else lifestyle end,
    work_detail = case when v_owner or v_level >= 9 then coalesce(p_work_detail, '') else work_detail end,
    money_style = case when v_owner or v_level >= 9 then coalesce(p_money_style, '') else money_style end,
    marriage_view = case when v_owner or v_level >= 11 then coalesce(p_marriage_view, '') else marriage_view end,
    extra_bio = case when v_owner or v_level >= 11 then coalesce(p_extra_bio, '') else extra_bio end,
    handle_changed_at = case when handle is distinct from v_handle then now() else handle_changed_at end,
    updated_at = now()
  where user_id = v_user;
end $$;

create or replace function public.set_my_profile_avatar(p_object_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
declare v_user uuid; v_auth uuid;
begin
  v_user := public.current_app_user_id();
  v_auth := auth.uid();
  if v_user is null or v_auth is null then raise exception 'authenticated user required'; end if;
  if p_object_path <> v_auth::text || '/avatar.jpg' then raise exception 'invalid avatar path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'profile-photos' and name = p_object_path) then
    raise exception 'avatar upload not found';
  end if;
  update public.profiles set avatar_url = p_object_path, updated_at = now() where user_id = v_user;
end $$;

create or replace function public.equip_profile_cosmetic(p_cosmetic_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_kind text;
begin
  v_user := public.current_app_user_id();
  select c.kind into v_kind
  from public.user_cosmetics uc join public.cosmetics c on c.id = uc.cosmetic_id
  where uc.user_id = v_user and uc.cosmetic_id = p_cosmetic_id and c.active;
  if v_user is null or v_kind is null then raise exception 'cosmetic unavailable'; end if;
  update public.profiles set
    equipped_frame = case when v_kind = 'frame' then p_cosmetic_id else equipped_frame end,
    equipped_background = case when v_kind in ('background', 'seasonal') then p_cosmetic_id else equipped_background end,
    equipped_title = case when v_kind in ('title', 'nameplate') then p_cosmetic_id else equipped_title end,
    updated_at = now()
  where user_id = v_user;
end $$;

revoke all on function public.update_member_profile_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.set_my_profile_avatar(text) from public, anon;
revoke all on function public.equip_profile_cosmetic(text) from public, anon;
grant execute on function public.update_member_profile_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.set_my_profile_avatar(text) to authenticated;
grant execute on function public.equip_profile_cosmetic(text) to authenticated;
