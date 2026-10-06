-- Public beta P0 audit: chat limits, rematch cooldown, real HOME stats,
-- private profile-photo authorization and stricter CROSS timing.

alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) between 1 and 100);

alter table public.message_reactions drop constraint if exists message_reactions_reaction_check;
update public.message_reactions set reaction=case reaction when 'smile' then 'sparkle' when 'thanks' then 'like' else reaction end;
alter table public.message_reactions add constraint message_reactions_reaction_check check (reaction in ('heart','sparkle','like'));

create or replace function public.send_match_message(p_match_id uuid,p_body text)
returns table(id bigint,match_id uuid,sender_id uuid,body text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_sender uuid;v_other uuid;v_body text;
begin
  v_sender:=public.current_app_user_id();perform public.assert_live_member(v_sender);
  v_body:=trim(coalesce(p_body,''));
  if char_length(v_body) not between 1 and 100 then raise exception 'message must be between 1 and 100 characters';end if;
  select case when m.user_a=v_sender then m.user_b else m.user_a end into v_other from public.matches m
    where m.id=p_match_id and m.ended_at is null and v_sender in(m.user_a,m.user_b);
  if v_other is null then raise exception 'active mutual match required';end if;
  perform public.assert_live_member(v_other);
  if exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_sender,v_other),(v_other,v_sender))) then raise exception 'message unavailable';end if;
  if exists(select 1 from public.messages m where m.sender_id=v_sender and m.match_id=p_match_id and m.body=v_body and m.created_at>now()-interval '10 seconds') then raise exception 'duplicate message';end if;
  if(select count(*) from public.messages m where m.sender_id=v_sender and m.created_at>now()-interval '1 minute')>=12 then raise exception 'message rate limit exceeded';end if;
  return query insert into public.messages(match_id,sender_id,body) values(p_match_id,v_sender,v_body)
    returning messages.id,messages.match_id,messages.sender_id,messages.body,messages.created_at,messages.read_at;
end $$;

create or replace function public.react_to_message(p_message_id bigint,p_reaction text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  v_user:=public.current_app_user_id();
  if p_reaction not in('heart','sparkle','like') then raise exception 'invalid reaction';end if;
  if not exists(select 1 from public.messages msg join public.matches m on m.id=msg.match_id
    where msg.id=p_message_id and m.ended_at is null and v_user in(m.user_a,m.user_b)) then raise exception 'active match required';end if;
  insert into public.message_reactions(message_id,user_id,reaction) values(p_message_id,v_user,p_reaction)
    on conflict(message_id,user_id) do update set reaction=excluded.reaction,created_at=now();
end $$;

create or replace function public.unmatch_member(p_match_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_a uuid;v_b uuid;v_crossing uuid;
begin
  v_user:=public.current_app_user_id();
  select user_a,user_b,crossing_id into v_a,v_b,v_crossing from public.matches
    where id=p_match_id and ended_at is null and v_user in(user_a,user_b) for update;
  if v_a is null then raise exception 'active match not found';end if;
  update public.matches set ended_at=now(),ended_by=v_user where id=p_match_id;
  delete from public.discovery_likes where(sender_id,receiver_id) in((v_a,v_b),(v_b,v_a));
  if v_crossing is not null then delete from public.likes where crossing_id=v_crossing;end if;
end $$;

create or replace function public.send_profile_like(p_receiver uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_sender uuid;v_sender_gender text;v_receiver_gender text;v_match uuid;
begin
  v_sender:=public.current_app_user_id();perform public.assert_live_member(v_sender);
  if p_receiver is null or p_receiver=v_sender then raise exception 'invalid profile';end if;
  perform public.assert_live_member(p_receiver);
  select gender into v_sender_gender from public.profiles where user_id=v_sender;
  select gender into v_receiver_gender from public.profiles where user_id=p_receiver;
  if not((v_sender_gender='man' and v_receiver_gender='woman')or(v_sender_gender='woman' and v_receiver_gender='man')) then raise exception 'profile unavailable';end if;
  if(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_sender and b.user_id=p_receiver)<5 then raise exception 'five common tags required';end if;
  if exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_sender,p_receiver),(p_receiver,v_sender))) then raise exception 'profile unavailable';end if;
  if exists(select 1 from public.matches m where v_sender in(m.user_a,m.user_b) and p_receiver in(m.user_a,m.user_b)
    and(m.ended_at is null or m.ended_at>now()-interval '30 days')) then raise exception 'rematch cooldown active';end if;
  if(select count(*) from public.discovery_likes dl where dl.sender_id=v_sender and dl.created_at>now()-interval '24 hours')>=50 then raise exception 'daily like limit reached';end if;
  insert into public.discovery_likes(sender_id,receiver_id,created_at) values(v_sender,p_receiver,now())
    on conflict(sender_id,receiver_id) do update set created_at=excluded.created_at;
  if exists(select 1 from public.discovery_likes where sender_id=p_receiver and receiver_id=v_sender) then
    update public.matches set ended_at=null,ended_by=null,created_at=now()
      where user_a=least(v_sender,p_receiver) and user_b=greatest(v_sender,p_receiver) and crossing_id is null
        and ended_at<=now()-interval '30 days' returning id into v_match;
    if v_match is null then
      insert into public.matches(user_a,user_b,crossing_id) values(least(v_sender,p_receiver),greatest(v_sender,p_receiver),null)
        on conflict(user_a,user_b) where crossing_id is null do nothing returning id into v_match;
    end if;
  end if;
  return v_match is not null;
end $$;

create or replace function public.create_match_after_mutual_tag()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.likes where sender_id=new.receiver_id and receiver_id=new.sender_id and crossing_id=new.crossing_id)
    and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((new.sender_id,new.receiver_id),(new.receiver_id,new.sender_id)))
    and not exists(select 1 from public.matches m where new.sender_id in(m.user_a,m.user_b) and new.receiver_id in(m.user_a,m.user_b)
      and(m.ended_at is null or m.ended_at>now()-interval '30 days')) then
    insert into public.matches(user_a,user_b,crossing_id)
      values(least(new.sender_id,new.receiver_id),greatest(new.sender_id,new.receiver_id),new.crossing_id) on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.get_today_home_stats()
returns table(cross_count integer,received_tag_count integer,new_match_count integer)
language plpgsql stable security definer set search_path=public as $$
declare v_user uuid;v_start timestamptz;v_end timestamptz;
begin
  v_user:=public.current_app_user_id();
  if v_user is null then return query select 0,0,0;return;end if;
  v_start:=((now() at time zone 'Asia/Tokyo')::date::timestamp at time zone 'Asia/Tokyo');
  v_end:=v_start+interval '1 day';
  return query select
    (select count(*)::integer from public.crossings c where v_user in(c.user_a,c.user_b) and c.crossed_at>=v_start and c.crossed_at<v_end),
    (select count(*)::integer from public.likes l where l.receiver_id=v_user and l.created_at>=v_start and l.created_at<v_end),
    (select count(*)::integer from public.matches m where v_user in(m.user_a,m.user_b) and m.created_at>=v_start and m.created_at<v_end and m.ended_at is null);
end $$;

create or replace function public.get_discovery_profiles_v2(p_limit integer default 24)
returns table(
  user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,liked boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text,relevance_score numeric
) language plpgsql stable security definer set search_path=public as $$
declare v_viewer uuid;v_gender text;
begin
  v_viewer:=public.current_app_user_id();perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id=v_viewer;
  if v_gender not in('man','woman') then return;end if;
  return query
  with candidates as(
    select u.id,p.display_name,p.handle,p.bio,u.role,u.last_seen_at,
      exists(select 1 from public.discovery_likes dl where dl.sender_id=v_viewer and dl.receiver_id=u.id) liked,
      coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]) tags,
      coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]) primaries,
      (select count(*)::integer from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_viewer and b.user_id=u.id) common_count,
      (select coalesce(sum(1.0/sqrt(greatest(1,(select count(*) from public.user_tags all_ut where all_ut.tag_id=a.tag_id)))),0) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_viewer and b.user_id=u.id) rare_score,
      (select count(*) from public.user_tags where user_id=u.id) tag_count
    from public.users u join public.profiles p on p.user_id=u.id
    where u.id<>v_viewer and u.status='active' and not u.is_demo and u.age_verified and u.age_verification_status='verified'
      and((v_gender='man' and p.gender='woman')or(v_gender='woman' and p.gender='man'))
      and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_viewer,u.id),(u.id,v_viewer)))
      and not exists(select 1 from public.matches m where v_viewer in(m.user_a,m.user_b) and u.id in(m.user_a,m.user_b)
        and(m.ended_at is null or m.ended_at>now()-interval '30 days'))
  )
  select c.id,c.display_name,c.handle,c.bio,null::text,c.role='owner',c.liked,c.tags,c.primaries,c.common_count,
    case when c.last_seen_at>now()-interval '3 days' then 'recent' when c.last_seen_at>now()-interval '90 days' then 'away' else 'inactive' end,
    round(((c.common_count/greatest(1,sqrt(c.tag_count::numeric)))+c.rare_score)::numeric,3) as score
  from candidates c where c.common_count>=5
  order by(case when c.last_seen_at<=now()-interval '90 days' then 1 else 0 end),score desc,c.last_seen_at desc
  limit least(greatest(coalesce(p_limit,24),1),50);
end $$;

create or replace function public.get_visible_member_profiles_v2(p_user_ids uuid[])
returns table(user_id uuid,display_name text,handle text,bio text,avatar_url text,is_official boolean,
  profile_tags text[],primary_tags text[],common_tag_count integer,activity_status text,profile_level smallint,activity_area text)
language sql stable security definer set search_path=public as $$
  select p.user_id,p.display_name,p.handle,p.bio,null::text,u.role='owner',
    coalesce((select array_agg(t.name order by ut.is_primary desc,ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id),array[]::text[]),
    coalesce((select array_agg(t.name order by ut.sort_order,t.name) from public.user_tags ut join public.tags t on t.id=ut.tag_id where ut.user_id=u.id and ut.is_primary),array[]::text[]),
    (select count(*)::integer from public.user_tags mine join public.user_tags theirs on theirs.tag_id=mine.tag_id where mine.user_id=public.current_app_user_id() and theirs.user_id=u.id),
    case when u.last_seen_at>now()-interval '3 days' then 'recent' when u.last_seen_at>now()-interval '90 days' then 'away' else 'inactive' end,
    p.profile_level,p.activity_area
  from public.profiles p join public.users u on u.id=p.user_id
  where p.user_id=any(coalesce(p_user_ids,array[]::uuid[])) and u.status='active' and not u.is_demo
    and(p.user_id=public.current_app_user_id()
      or exists(select 1 from public.crossings c where c.expires_at>now() and public.current_app_user_id() in(c.user_a,c.user_b) and p.user_id in(c.user_a,c.user_b))
      or exists(select 1 from public.matches m where m.ended_at is null and public.current_app_user_id() in(m.user_a,m.user_b) and p.user_id in(m.user_a,m.user_b)))
$$;

create or replace function public.get_authorized_profile_photo_paths(p_user_ids uuid[])
returns table(user_id uuid,object_path text)
language plpgsql stable security definer set search_path=public as $$
declare v_viewer uuid;v_gender text;
begin
  v_viewer:=public.current_app_user_id();perform public.assert_live_member(v_viewer);
  select p.gender into v_gender from public.profiles p where p.user_id=v_viewer;
  return query
  select p.user_id,p.avatar_url from public.profiles p join public.users u on u.id=p.user_id
  where p.user_id=any(coalesce(p_user_ids,array[]::uuid[])) and p.avatar_url is not null and u.status='active' and not u.is_demo
    and(p.user_id=v_viewer
      or exists(select 1 from public.crossings c where c.expires_at>now() and v_viewer in(c.user_a,c.user_b) and p.user_id in(c.user_a,c.user_b))
      or exists(select 1 from public.matches m where m.ended_at is null and v_viewer in(m.user_a,m.user_b) and p.user_id in(m.user_a,m.user_b))
      or(u.age_verified and u.age_verification_status='verified' and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
        and((v_gender='man' and p.gender='woman')or(v_gender='woman' and p.gender='man'))
        and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=v_viewer and b.user_id=p.user_id)>=5
        and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_viewer,p.user_id),(p.user_id,v_viewer)))
        and not exists(select 1 from public.matches m where v_viewer in(m.user_a,m.user_b) and p.user_id in(m.user_a,m.user_b)
          and(m.ended_at is null or m.ended_at>now()-interval '30 days'))))
  ;
end;
$$;

create or replace function public.detect_crossings_private(p_radius_meters integer default 1000,p_overlap_minutes integer default 3)
returns integer language plpgsql security definer set search_path=public as $$
declare created_count integer;
begin
  with candidate_pairs as(
    select least(sa.user_id,sb.user_id) user_a,greatest(sa.user_id,sb.user_id) user_b,greatest(la.captured_at,lb.captured_at) crossed_at,
      case when(la.latitude+lb.latitude)/2<35.64 then '東京南部エリア' when(la.longitude+lb.longitude)/2<139.65 then '東京西部エリア' when(la.longitude+lb.longitude)/2>139.82 then '東京東部エリア' else '東京中央エリア' end area_label
    from public.tag_sessions sa join public.location_samples la on la.session_id=sa.id
    join public.tag_sessions sb on sb.id>sa.id and sb.status='active'
    join public.location_samples lb on lb.session_id=sb.id
    join public.profiles pa on pa.user_id=sa.user_id join public.profiles pb on pb.user_id=sb.user_id
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and abs(extract(epoch from(la.captured_at-lb.captured_at)))<=180
      and((pa.gender='man' and pb.gender='woman')or(pa.gender='woman' and pb.gender='man'))
      and public.distance_meters(la.latitude,la.longitude,lb.latitude,lb.longitude)<=least(greatest(p_radius_meters,100),1000)
      and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as(
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('minute',crossed_at) from candidate_pairs on conflict do nothing returning 1
  )select count(*) into created_count from inserted;
  return created_count;
end $$;

create or replace function public.award_crossing_exp()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_day_start timestamptz;v_day_end timestamptz;
begin
  v_day_start:=((now() at time zone 'Asia/Tokyo')::date::timestamp at time zone 'Asia/Tokyo');
  v_day_end:=v_day_start+interval '1 day';
  if not exists(
    select 1 from public.exp_ledger e join public.crossings c on e.reference_id=c.id::text
    where e.user_id=new.user_a and e.reason='crossing' and e.created_at>=v_day_start and e.created_at<v_day_end
      and c.user_a=new.user_a and c.user_b=new.user_b
  ) then perform public.issue_exp(new.user_a,5+floor(random()*6)::integer,'crossing','crossing',new.id::text);end if;
  if not exists(
    select 1 from public.exp_ledger e join public.crossings c on e.reference_id=c.id::text
    where e.user_id=new.user_b and e.reason='crossing' and e.created_at>=v_day_start and e.created_at<v_day_end
      and c.user_a=new.user_a and c.user_b=new.user_b
  ) then perform public.issue_exp(new.user_b,5+floor(random()*6)::integer,'crossing','crossing',new.id::text);end if;
  return new;
end $$;

create or replace function public.contribute_area_exp(
  p_area_id text,p_amount integer,p_latitude double precision,p_longitude double precision
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_points bigint;v_area public.areas%rowtype;v_location public.location_samples%rowtype;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  if p_amount<100 or p_amount>1000 or p_amount%100<>0 then raise exception 'invalid contribution';end if;
  select * into v_area from public.areas where id=p_area_id and active;
  if v_area.id is null then raise exception 'area unavailable';end if;
  select ls.* into v_location from public.location_samples ls join public.tag_sessions s on s.id=ls.session_id
    where s.user_id=v_user and s.status='active' and s.expires_at>now() and ls.captured_at>now()-interval '2 minutes'
      and coalesce(ls.accuracy_m,9999)<=75 order by ls.captured_at desc limit 1;
  if v_location.id is null then raise exception 'recent TAG ON location required';end if;
  if public.distance_meters(v_location.latitude,v_location.longitude,v_area.latitude,v_area.longitude)>v_area.contribution_radius_m then
    raise exception 'EXP can be contributed only within 1km of the area base';end if;
  perform public.spend_exp(v_user,p_amount,'area_contribution','area',p_area_id);
  insert into public.area_contributions(area_id,user_id,points) values(p_area_id,v_user,p_amount)
    on conflict(area_id,user_id) do update set points=area_contributions.points+excluded.points,updated_at=now()
    returning points into v_points;
  return v_points;
end $$;

create or replace function public.draw_tag_spot(
  p_spot_id text,p_latitude double precision,p_longitude double precision
) returns table(reward_type text,reward_key text,reward_exp integer)
language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_spot public.tag_spots%rowtype;v_location public.location_samples%rowtype;v_roll double precision;v_type text;v_key text;v_exp integer;
begin
  v_user:=public.current_app_user_id();perform public.assert_live_member(v_user);
  select * into v_spot from public.tag_spots where id=p_spot_id and active;
  if v_spot.id is null then raise exception 'spot unavailable';end if;
  select ls.* into v_location from public.location_samples ls join public.tag_sessions s on s.id=ls.session_id
    where s.user_id=v_user and s.status='active' and s.expires_at>now() and ls.captured_at>now()-interval '2 minutes'
      and coalesce(ls.accuracy_m,9999)<=75 order by ls.captured_at desc limit 1;
  if v_location.id is null then raise exception 'recent TAG ON location required';end if;
  if public.distance_meters(v_location.latitude,v_location.longitude,v_spot.latitude,v_spot.longitude)>v_spot.radius_m then raise exception 'move closer to TAG SPOT';end if;
  if exists(select 1 from public.tag_spot_draws where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date) then raise exception 'already drawn today';end if;
  v_roll:=random();
  if v_roll<1.0/300 then v_type:='cosmetic';v_key:='spot-ssr';v_exp:=0;
  elsif v_roll<1.0/80 then v_type:='cosmetic';v_key:='spot-sr';v_exp:=0;
  elsif v_roll<1.0/25 then v_type:='cosmetic';v_key:='spot-rare';v_exp:=0;
  elsif v_roll<0.12 then v_type:='exp';v_key:='exp-100';v_exp:=100;
  elsif v_roll<0.37 then v_type:='exp';v_key:='exp-50';v_exp:=50;
  else v_type:='exp';v_key:='exp-30';v_exp:=30;end if;
  insert into public.tag_spot_draws(user_id,spot_id,reward_type,reward_key,reward_exp) values(v_user,p_spot_id,v_type,v_key,v_exp);
  if v_type='cosmetic' and exists(select 1 from public.user_cosmetics where user_id=v_user and cosmetic_id=v_key) then
    v_type:='exp';v_key:='duplicate-compensation';v_exp:=100;
    update public.tag_spot_draws set reward_type=v_type,reward_key=v_key,reward_exp=v_exp
      where user_id=v_user and spot_id=p_spot_id and draw_date=(now() at time zone 'Asia/Tokyo')::date;
  end if;
  if v_type='exp' then perform public.issue_exp(v_user,v_exp,'tag_spot','tag_spot',p_spot_id);
  else insert into public.user_cosmetics(user_id,cosmetic_id,source) values(v_user,v_key,'tag_spot') on conflict do nothing;end if;
  return query select v_type,v_key,v_exp;
end $$;

revoke all on function public.get_today_home_stats() from public,anon;
revoke all on function public.get_discovery_profiles_v2(integer) from public,anon;
revoke all on function public.get_visible_member_profiles_v2(uuid[]) from public,anon;
revoke all on function public.get_authorized_profile_photo_paths(uuid[]) from public,anon;
grant execute on function public.get_today_home_stats() to authenticated;
grant execute on function public.get_discovery_profiles_v2(integer) to authenticated;
grant execute on function public.get_visible_member_profiles_v2(uuid[]) to authenticated;
grant execute on function public.get_authorized_profile_photo_paths(uuid[]) to authenticated;
