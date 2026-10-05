-- TAG TOKYO v0.5 integrated rules: opposite-gender CROSS, 1km radius,
-- 30-minute TAG ON, Lv100 progression and 90-day inactive status.

alter table public.profiles drop constraint if exists profiles_profile_level_check;
alter table public.profiles add constraint profiles_profile_level_check check (profile_level between 1 and 100);
alter table public.profile_unlocks drop constraint if exists profile_unlocks_required_level_check;
alter table public.profile_unlocks add constraint profile_unlocks_required_level_check check (required_level between 1 and 100);

create or replace function public.profile_level_for_exp(p_total bigint)
returns smallint language sql immutable as $$
  select least(100,greatest(1,
    floor(1 + 99 * power(least(greatest(coalesce(p_total,0),0),30000)::numeric / 30000,1.0/1.35))::integer
  ))::smallint
$$;

update public.profiles set profile_level=public.profile_level_for_exp(total_earned_exp);

create index if not exists profiles_gender_updated_idx on public.profiles(gender,updated_at desc);
create index if not exists users_live_activity_idx on public.users(status,is_demo,last_seen_at desc);

create or replace function public.start_tag_session(
  p_latitude double precision,p_longitude double precision,p_duration_minutes integer,p_delete_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_session uuid;
begin
  v_user:=public.current_app_user_id();
  perform public.assert_live_member(v_user);
  if p_duration_minutes<>30 then raise exception 'TAG ON sessions are limited to 30 minutes';end if;
  if p_latitude<35.49 or p_latitude>35.90 or p_longitude<138.94 or p_longitude>139.93 then
    raise exception 'TAG ON is available only in Tokyo';
  end if;
  update public.tag_sessions set status='stopped',ended_at=now() where user_id=v_user and status='active';
  insert into public.tag_sessions(user_id,expires_at,duration_minutes)
    values(v_user,now()+interval '30 minutes',30) returning id into v_session;
  insert into public.location_samples(session_id,latitude,longitude,captured_at,delete_at)
    values(v_session,p_latitude,p_longitude,now(),least(p_delete_at,now()+interval '24 hours'));
  return v_session;
end $$;

create or replace function public.get_discovery_profiles(p_limit integer default 24)
returns table(
  user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,liked boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text,relevance_score numeric
) language plpgsql stable security definer set search_path=public as $$
declare v_viewer uuid;v_gender text;
begin
  v_viewer:=public.current_app_user_id();
  perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id=v_viewer;
  if v_gender not in('man','woman') then return;end if;

  return query
  with candidates as (
    select u.id,p.display_name,p.handle,p.bio,p.avatar_url,u.role,u.last_seen_at,
      exists(select 1 from public.discovery_likes dl where dl.sender_id=v_viewer and dl.receiver_id=u.id) liked,
      coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]) tags,
      coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]) primaries,
      (select count(*)::integer from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_viewer and b.user_id=u.id) common_count,
      (select coalesce(sum(1.0/sqrt(greatest(1,(select count(*) from public.user_tags all_ut where all_ut.tag_id=a.tag_id)))),0) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_viewer and b.user_id=u.id) rare_score,
      (select count(*) from public.user_tags where user_id=u.id) tag_count
    from public.users u join public.profiles p on p.user_id=u.id
    where u.id<>v_viewer and u.status='active' and not u.is_demo and u.age_verified and u.age_verification_status='verified'
      and ((v_gender='man' and p.gender='woman') or(v_gender='woman' and p.gender='man'))
      and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_viewer,u.id),(u.id,v_viewer)))
      and not exists(select 1 from public.matches m where m.ended_at is null and v_viewer in(m.user_a,m.user_b) and u.id in(m.user_a,m.user_b))
  )
  select c.id,c.display_name,c.handle,c.bio,c.avatar_url,c.role='owner',c.liked,c.tags,c.primaries,c.common_count,
    case when c.last_seen_at>now()-interval '3 days' then 'recent' when c.last_seen_at>now()-interval '90 days' then 'away' else 'inactive' end,
    round((c.common_count/greatest(1,sqrt(c.tag_count::numeric)))+c.rare_score,3)
  from candidates c where c.common_count>=5
  order by(case when c.last_seen_at<=now()-interval '90 days' then 1 else 0 end),relevance_score desc,c.last_seen_at desc
  limit least(greatest(coalesce(p_limit,24),1),50);
end $$;

create or replace function public.send_profile_like(p_receiver uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_sender uuid;v_matched boolean:=false;v_sender_gender text;v_receiver_gender text;
begin
  v_sender:=public.current_app_user_id();perform public.assert_live_member(v_sender);
  if p_receiver is null or p_receiver=v_sender then raise exception 'invalid profile';end if;
  perform public.assert_live_member(p_receiver);
  select gender into v_sender_gender from public.profiles where user_id=v_sender;
  select gender into v_receiver_gender from public.profiles where user_id=p_receiver;
  if not((v_sender_gender='man' and v_receiver_gender='woman') or(v_sender_gender='woman' and v_receiver_gender='man')) then raise exception 'profile unavailable';end if;
  if(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_sender and b.user_id=p_receiver)<5 then raise exception 'five common tags required';end if;
  if exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_sender,p_receiver),(p_receiver,v_sender))) then raise exception 'profile unavailable';end if;
  if(select count(*) from public.discovery_likes dl where dl.sender_id=v_sender and dl.created_at>now()-interval '24 hours')>=50 then raise exception 'daily like limit reached';end if;
  insert into public.discovery_likes(sender_id,receiver_id) values(v_sender,p_receiver) on conflict do nothing;
  if exists(select 1 from public.discovery_likes dl where dl.sender_id=p_receiver and dl.receiver_id=v_sender) then
    insert into public.matches(user_a,user_b,crossing_id) values(least(v_sender,p_receiver),greatest(v_sender,p_receiver),null)
      on conflict(user_a,user_b) where crossing_id is null do nothing;
    v_matched:=true;
  end if;
  return v_matched;
end $$;

create or replace function public.get_visible_member_profiles(p_user_ids uuid[])
returns table(user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text)
language sql stable security definer set search_path=public as $$
  select p.user_id,p.display_name,p.handle,p.bio,p.avatar_url,u.role='owner',
    coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]),
    coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]),
    (select count(*)::integer from public.user_tags mine join public.user_tags theirs on theirs.tag_id=mine.tag_id where mine.user_id=public.current_app_user_id() and theirs.user_id=u.id),
    case when u.last_seen_at>now()-interval '3 days' then 'recent' when u.last_seen_at>now()-interval '90 days' then 'away' else 'inactive' end
  from public.profiles p join public.users u on u.id=p.user_id
  where p.user_id=any(coalesce(p_user_ids,array[]::uuid[])) and u.status='active' and not u.is_demo
    and(p.user_id=public.current_app_user_id()
      or exists(select 1 from public.crossings c where c.expires_at>now() and public.current_app_user_id() in(c.user_a,c.user_b) and p.user_id in(c.user_a,c.user_b))
      or exists(select 1 from public.matches m where m.ended_at is null and public.current_app_user_id() in(m.user_a,m.user_b) and p.user_id in(m.user_a,m.user_b)))
$$;

create or replace function public.detect_crossings_private(p_radius_meters integer default 1000,p_overlap_minutes integer default 3)
returns integer language plpgsql security definer set search_path=public as $$
declare created_count integer;
begin
  with candidate_pairs as(
    select least(sa.user_id,sb.user_id) user_a,greatest(sa.user_id,sb.user_id) user_b,greatest(sa.started_at,sb.started_at) crossed_at,
      case when(la.latitude+lb.latitude)/2<35.64 then '東京南部エリア' when(la.longitude+lb.longitude)/2<139.65 then '東京西部エリア' when(la.longitude+lb.longitude)/2>139.82 then '東京東部エリア' else '東京中央エリア' end area_label
    from public.tag_sessions sa join public.location_samples la on la.session_id=sa.id
    join public.tag_sessions sb on sb.id>sa.id and sb.status='active' and least(sa.expires_at,sb.expires_at)>=greatest(sa.started_at,sb.started_at)+make_interval(mins=>p_overlap_minutes)
    join public.location_samples lb on lb.session_id=sb.id
    join public.profiles pa on pa.user_id=sa.user_id join public.profiles pb on pb.user_id=sb.user_id
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and((pa.gender='man' and pb.gender='woman')or(pa.gender='woman' and pb.gender='man'))
      and 6371000*2*asin(sqrt(power(sin(radians(lb.latitude-la.latitude)/2),2)+cos(radians(la.latitude))*cos(radians(lb.latitude))*power(sin(radians(lb.longitude-la.longitude)/2),2)))<=least(greatest(p_radius_meters,100),1000)
      and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as(
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('hour',crossed_at) from candidate_pairs on conflict do nothing returning 1
  )select count(*) into created_count from inserted;
  return created_count;
end $$;

revoke all on function public.start_tag_session(double precision,double precision,integer,timestamptz) from public,anon;
revoke all on function public.get_discovery_profiles(integer) from public,anon;
revoke all on function public.send_profile_like(uuid) from public,anon;
revoke all on function public.get_visible_member_profiles(uuid[]) from public,anon;
revoke all on function public.detect_crossings_private(integer,integer) from public,anon,authenticated;
grant execute on function public.start_tag_session(double precision,double precision,integer,timestamptz) to authenticated;
grant execute on function public.get_discovery_profiles(integer) to authenticated;
grant execute on function public.send_profile_like(uuid) to authenticated;
grant execute on function public.get_visible_member_profiles(uuid[]) to authenticated;
