-- TAG TOKYO v0.5: persist the public activity area and issue real Lv50/Lv100 rewards.

insert into public.cosmetics (id,name,kind,exp_cost,rarity) values
  ('title-level-50','CITY EXPLORER','title',null,'rare'),
  ('frame-level-100','TOKYO MASTER','frame',null,'ssr'),
  ('background-level-100','TOKYO HORIZON','background',null,'ssr'),
  ('title-level-100','東京を歩ききった人','title',null,'ssr')
on conflict (id) do update set
  name=excluded.name,kind=excluded.kind,exp_cost=excluded.exp_cost,rarity=excluded.rarity,active=true;

create or replace function public.update_member_profile_v3(
  p_display_name text,
  p_handle text,
  p_bio text,
  p_gender text,
  p_activity_area text,
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
  if char_length(coalesce(p_activity_area, '')) > 60 then raise exception 'activity area too long'; end if;
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
    activity_area = trim(coalesce(p_activity_area, '')),
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

create or replace function public.claim_level_rewards()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_level smallint;
  v_awarded text[] := array[]::text[];
  v_reward text;
begin
  v_user := public.current_app_user_id();
  if v_user is null then return v_awarded; end if;
  select profile_level into v_level from public.profiles where user_id=v_user;
  if v_level is null then return v_awarded; end if;

  for v_reward in
    select reward_id from (values
      ('title-level-50'::text,50),
      ('frame-level-100'::text,100),
      ('background-level-100'::text,100),
      ('title-level-100'::text,100)
    ) as rewards(reward_id,required_level)
    where v_level >= required_level
  loop
    insert into public.user_cosmetics(user_id,cosmetic_id,source)
      values(v_user,v_reward,'level_reward') on conflict do nothing;
    if found then v_awarded := array_append(v_awarded,v_reward); end if;
  end loop;
  return v_awarded;
end $$;

revoke all on function public.update_member_profile_v3(text,text,text,text,text,text,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.claim_level_rewards() from public,anon;
grant execute on function public.update_member_profile_v3(text,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.claim_level_rewards() to authenticated;
