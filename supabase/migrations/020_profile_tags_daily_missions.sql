-- TAG TOKYO v0.4 follow-up: curated profile tags and gentle daily missions.

insert into public.tags (name) values
  ('音楽'),('ゲーム'),('カードゲーム'),('アニメ'),('映画'),('お笑い'),('怪談'),('古着'),('ファッション'),
  ('カフェ'),('ラーメン'),('お酒'),('旅行'),('スポーツ'),('写真'),('クリエイター'),('仕事'),('恋愛'),('友達募集')
on conflict (name) do nothing;

create or replace function public.set_my_profile_tags(p_tag_names text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_count integer;
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);
  select count(distinct selected.name) into v_count
    from unnest(coalesce(p_tag_names,array[]::text[])) as selected(name);
  if v_count > 8 then raise exception 'up to 8 profile tags can be selected'; end if;
  if exists (
    select 1 from unnest(coalesce(p_tag_names,array[]::text[])) as selected(name)
    where not exists (select 1 from public.tags t where t.name=selected.name)
  ) then raise exception 'unknown profile tag'; end if;
  delete from public.user_tags where user_id=v_user;
  insert into public.user_tags (user_id,tag_id)
    select v_user,t.id from public.tags t
    where t.name=any(coalesce(p_tag_names,array[]::text[]));
end $$;

drop function if exists public.get_discovery_profiles(integer);
create function public.get_discovery_profiles(p_limit integer default 24)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  avatar_url text,
  is_official boolean,
  liked boolean,
  profile_tags text[],
  common_tag_count integer
) language plpgsql stable security definer set search_path = public as $$
declare v_viewer uuid; v_gender text;
begin
  v_viewer := public.current_app_user_id();
  perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id=v_viewer;

  return query
  select
    p.user_id,p.display_name,p.handle,p.bio,p.avatar_url,
    (u.role='owner') as is_official,
    exists (select 1 from public.discovery_likes dl where dl.sender_id=v_viewer and dl.receiver_id=u.id) as liked,
    coalesce((select array_agg(t.name order by t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]) as profile_tags,
    (select count(*)::integer from public.user_tags mine join public.user_tags theirs on theirs.tag_id=mine.tag_id where mine.user_id=v_viewer and theirs.user_id=u.id) as common_tag_count
  from public.users u
  join public.profiles p on p.user_id=u.id
  where u.id<>v_viewer
    and u.status='active' and not u.is_demo and u.age_verified and u.age_verification_status='verified'
    and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
    and not exists (select 1 from public.blocks b where (b.blocker_id=v_viewer and b.blocked_id=u.id) or (b.blocker_id=u.id and b.blocked_id=v_viewer))
    and not exists (select 1 from public.matches m where v_viewer in (m.user_a,m.user_b) and u.id in (m.user_a,m.user_b))
  order by
    case when v_gender='woman' and u.role='owner' then 0 else 1 end,
    (select count(*) from public.user_tags mine join public.user_tags theirs on theirs.tag_id=mine.tag_id where mine.user_id=v_viewer and theirs.user_id=u.id) desc,
    p.updated_at desc,u.created_at desc
  limit least(greatest(coalesce(p_limit,24),1),50);
end $$;

create table if not exists public.daily_mission_claims (
  user_id uuid not null references public.users(id) on delete cascade,
  claim_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  mission_key text not null check (mission_key in ('tag_on','walk_1km','cross_opened','all_complete')),
  reward_exp integer not null check (reward_exp in (10,20)),
  created_at timestamptz not null default now(),
  primary key (user_id,claim_date,mission_key)
);

alter table public.daily_mission_claims enable row level security;
drop policy if exists daily_mission_claims_self_read on public.daily_mission_claims;
create policy daily_mission_claims_self_read on public.daily_mission_claims for select
  using (user_id=public.current_app_user_id());

create or replace function public.claim_daily_mission(p_mission_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_date date := (now() at time zone 'Asia/Tokyo')::date;
  v_reward integer;
  v_inserted integer := 0;
  v_bonus integer := 0;
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);
  if p_mission_key='tag_on' then
    if not exists (select 1 from public.tag_sessions s where s.user_id=v_user and (s.started_at at time zone 'Asia/Tokyo')::date=v_date) then return 0; end if;
    v_reward := 10;
  elsif p_mission_key='walk_1km' then
    if not exists (select 1 from public.daily_movement m where m.user_id=v_user and m.movement_date=v_date and m.valid_distance_m>=1000) then return 0; end if;
    v_reward := 20;
  elsif p_mission_key='cross_opened' then
    v_reward := 10;
  else
    raise exception 'invalid daily mission';
  end if;

  insert into public.daily_mission_claims (user_id,claim_date,mission_key,reward_exp)
    values (v_user,v_date,p_mission_key,v_reward) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=1 then perform public.issue_exp(v_user,v_reward,'mission','daily_mission',v_date::text||':'||p_mission_key); end if;

  if (select count(*) from public.daily_mission_claims c where c.user_id=v_user and c.claim_date=v_date and c.mission_key in ('tag_on','walk_1km','cross_opened'))=3 then
    insert into public.daily_mission_claims (user_id,claim_date,mission_key,reward_exp)
      values (v_user,v_date,'all_complete',20) on conflict do nothing;
    if found then
      perform public.issue_exp(v_user,20,'mission','daily_mission',v_date::text||':all_complete');
      v_bonus := 20;
    end if;
  end if;
  return case when v_inserted=1 then v_reward else 0 end + v_bonus;
end $$;

create or replace function public.get_daily_missions()
returns table(mission_key text,reward_exp integer,completed boolean)
language sql stable security definer set search_path = public as $$
  with definitions(mission_key,reward_exp,sort_order) as (
    values ('tag_on',10,1),('walk_1km',20,2),('cross_opened',10,3),('all_complete',20,4)
  )
  select d.mission_key,d.reward_exp,exists(
    select 1 from public.daily_mission_claims c
    where c.user_id=public.current_app_user_id()
      and c.claim_date=(now() at time zone 'Asia/Tokyo')::date
      and c.mission_key=d.mission_key
  )
  from definitions d order by d.sort_order
$$;

revoke all on function public.set_my_profile_tags(text[]) from public,anon;
revoke all on function public.get_discovery_profiles(integer) from public,anon;
revoke all on function public.claim_daily_mission(text) from public,anon;
revoke all on function public.get_daily_missions() from public,anon;
revoke all on public.daily_mission_claims from anon,authenticated;
grant select on public.daily_mission_claims to authenticated;
grant execute on function public.set_my_profile_tags(text[]) to authenticated;
grant execute on function public.get_discovery_profiles(integer) to authenticated;
grant execute on function public.claim_daily_mission(text) to authenticated;
grant execute on function public.get_daily_missions() to authenticated;
