-- Remove all fabricated profiles and public read paths used by the old UI.

delete from public.users where is_demo = true;
delete from public.app_settings where key = 'demo_profile_ratio';

drop policy if exists public_demo_setting on public.app_settings;

drop policy if exists profiles_visible_connections on public.profiles;
create policy profiles_visible_connections on public.profiles for select using (
  user_id = public.current_app_user_id()
  or exists (
    select 1 from public.crossings c
    where c.expires_at > now()
      and public.current_app_user_id() in (c.user_a, c.user_b)
      and user_id in (c.user_a, c.user_b)
  )
  or exists (
    select 1 from public.matches m
    where public.current_app_user_id() in (m.user_a, m.user_b)
      and user_id in (m.user_a, m.user_b)
  )
);

drop policy if exists user_tags_visible on public.user_tags;
create policy user_tags_visible on public.user_tags for select using (
  user_id = public.current_app_user_id()
  or exists (
    select 1 from public.crossings c
    where public.current_app_user_id() in (c.user_a, c.user_b)
      and user_id in (c.user_a, c.user_b)
  )
);
