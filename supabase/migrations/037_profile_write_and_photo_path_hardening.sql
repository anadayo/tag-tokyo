-- Prevent authenticated clients from bypassing validated profile RPCs.
-- Security-definer functions remain able to create and update these rows.
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update, delete on public.user_tags from authenticated;

-- PostgreSQL grants EXECUTE to PUBLIC for new functions unless it is revoked.
-- Keep client-callable RPCs authenticated-only and trigger/helper functions
-- unavailable through the exposed API.
revoke all on function public.contribute_area_exp(text, integer, double precision, double precision) from public, anon, authenticated;
revoke all on function public.create_match_after_mutual_tag() from public, anon, authenticated;
revoke all on function public.current_app_user_id() from public, anon, authenticated;
revoke all on function public.exchange_cosmetic(text) from public, anon, authenticated;
revoke all on function public.get_today_movement() from public, anon, authenticated;
revoke all on function public.handle_beta_email_confirmation() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.send_match_message(uuid, text) from public, anon, authenticated;
revoke all on function public.stop_tag_session() from public, anon, authenticated;
revoke all on function public.update_tag_location(uuid, double precision, double precision, double precision, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.contribute_area_exp(text, integer, double precision, double precision) to authenticated;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.exchange_cosmetic(text) to authenticated;
grant execute on function public.get_today_movement() to authenticated;
grant execute on function public.send_match_message(uuid, text) to authenticated;
grant execute on function public.stop_tag_session() to authenticated;
grant execute on function public.update_tag_location(uuid, double precision, double precision, double precision, timestamptz, timestamptz) to authenticated;

alter function public.distance_meters(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.guard_demo_interactions() set search_path = public;
alter function public.profile_level_for_exp(bigint) set search_path = public;

-- Defense in depth: only sign the canonical avatar object owned by the
-- profile's auth user, even if a profile row is corrupted or edited manually.
create or replace function public.get_authorized_profile_photo_paths(p_user_ids uuid[])
returns table(user_id uuid, object_path text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid;
  v_gender text;
begin
  v_viewer := public.current_app_user_id();
  perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id = v_viewer;

  return query
  select p.user_id, p.avatar_url
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.user_id = any(coalesce(p_user_ids, array[]::uuid[]))
    and p.avatar_url is not null
    and u.auth_user_id is not null
    and p.avatar_url = u.auth_user_id::text || '/avatar.jpg'
    and u.status = 'active'
    and not u.is_demo
    and (
      p.user_id = v_viewer
      or exists (
        select 1 from public.crossings c
        where c.expires_at > now()
          and v_viewer in (c.user_a, c.user_b)
          and p.user_id in (c.user_a, c.user_b)
      )
      or exists (
        select 1 from public.matches m
        where m.ended_at is null
          and v_viewer in (m.user_a, m.user_b)
          and p.user_id in (m.user_a, m.user_b)
      )
      or (
        u.age_verified
        and u.age_verification_status = 'verified'
        and u.terms_accepted_at is not null
        and u.privacy_accepted_at is not null
        and (
          (v_gender = 'man' and p.gender = 'woman')
          or (v_gender = 'woman' and p.gender = 'man')
        )
        and (
          select count(*)
          from public.user_tags a
          join public.user_tags b on b.tag_id = a.tag_id
          where a.user_id = v_viewer and b.user_id = p.user_id
        ) >= 5
        and not exists (
          select 1 from public.blocks b
          where (b.blocker_id, b.blocked_id) in ((v_viewer, p.user_id), (p.user_id, v_viewer))
        )
        and not exists (
          select 1 from public.matches m
          where v_viewer in (m.user_a, m.user_b)
            and p.user_id in (m.user_a, m.user_b)
            and (m.ended_at is null or m.ended_at > now() - interval '30 days')
        )
      )
    );
end;
$$;

revoke all on function public.get_authorized_profile_photo_paths(uuid[]) from public, anon;
grant execute on function public.get_authorized_profile_photo_paths(uuid[]) to authenticated;
