-- TAG TOKYO v3 map network and matching safety.
-- Station coordinates are public map reference points and must be field-reviewed
-- before changing a live spot's physical pickup point.

alter table public.tag_spots
  add column if not exists network text,
  add column if not exists station_code text;

create unique index if not exists tag_spots_network_station_unique
  on public.tag_spots(network,station_code)
  where network is not null and station_code is not null;

with stations(id,name,romanized,latitude,longitude,map_x,map_y) as(values
  ('tokyo','東京','TOKYO',35.681236,139.767125,79,49),('kanda','神田','KANDA',35.691690,139.770883,80,43),
  ('akihabara','秋葉原','AKIHABARA',35.698353,139.773114,81,39),('okachimachi','御徒町','OKACHIMACHI',35.707438,139.774632,82,33),
  ('ueno','上野','UENO',35.713768,139.777254,83,29),('uguisudani','鶯谷','UGUISUDANI',35.720495,139.778837,84,25),
  ('nippori','日暮里','NIPPORI',35.727772,139.770987,80,20),('nishi-nippori','西日暮里','NISHI-NIPPORI',35.732135,139.766787,79,17),
  ('tabata','田端','TABATA',35.738062,139.760860,76,14),('komagome','駒込','KOMAGOME',35.736489,139.746875,71,15),
  ('sugamo','巣鴨','SUGAMO',35.733445,139.739290,68,17),('otsuka','大塚','OTSUKA',35.731401,139.728662,64,18),
  ('ikebukuro','池袋','IKEBUKURO',35.728926,139.710380,56,19),('mejiro','目白','MEJIRO',35.721204,139.706587,55,24),
  ('takadanobaba','高田馬場','TAKADANOBABA',35.712677,139.703715,53,30),('shin-okubo','新大久保','SHIN-OKUBO',35.701306,139.700044,52,37),
  ('shinjuku','新宿','SHINJUKU',35.689592,139.700413,52,44),('yoyogi','代々木','YOYOGI',35.683061,139.702042,53,48),
  ('harajuku','原宿','HARAJUKU',35.670168,139.702689,53,56),('shibuya','渋谷','SHIBUYA',35.658034,139.701636,53,64),
  ('ebisu','恵比寿','EBISU',35.646690,139.710106,56,71),('meguro','目黒','MEGURO',35.633998,139.715828,58,79),
  ('gotanda','五反田','GOTANDA',35.626446,139.723444,61,84),('osaki','大崎','OSAKI',35.619700,139.728553,63,88),
  ('shinagawa','品川','SHINAGAWA',35.628471,139.738760,67,82),('takanawa-gateway','高輪ゲートウェイ','TAKANAWA GATEWAY',35.635500,139.740700,68,78),
  ('tamachi','田町','TAMACHI',35.645736,139.747575,71,71),('hamamatsucho','浜松町','HAMAMATSUCHO',35.655646,139.756749,75,65),
  ('shimbashi','新橋','SHIMBASHI',35.666195,139.758587,76,59),('yurakucho','有楽町','YURAKUCHO',35.675069,139.763328,77,53)
)
insert into public.areas(id,name,map_x,map_y,latitude,longitude,contribution_radius_m,active)
select id,name,map_x,map_y,latitude,longitude,1000,true from stations
on conflict(id) do update set name=excluded.name,map_x=excluded.map_x,map_y=excluded.map_y,
  latitude=excluded.latitude,longitude=excluded.longitude,contribution_radius_m=1000,active=true;

with stations(id,romanized,latitude,longitude,map_x,map_y) as(values
  ('tokyo','TOKYO',35.681236,139.767125,79,49),('kanda','KANDA',35.691690,139.770883,80,43),
  ('akihabara','AKIHABARA',35.698353,139.773114,81,39),('okachimachi','OKACHIMACHI',35.707438,139.774632,82,33),
  ('ueno','UENO',35.713768,139.777254,83,29),('uguisudani','UGUISUDANI',35.720495,139.778837,84,25),
  ('nippori','NIPPORI',35.727772,139.770987,80,20),('nishi-nippori','NISHI-NIPPORI',35.732135,139.766787,79,17),
  ('tabata','TABATA',35.738062,139.760860,76,14),('komagome','KOMAGOME',35.736489,139.746875,71,15),
  ('sugamo','SUGAMO',35.733445,139.739290,68,17),('otsuka','OTSUKA',35.731401,139.728662,64,18),
  ('ikebukuro','IKEBUKURO',35.728926,139.710380,56,19),('mejiro','MEJIRO',35.721204,139.706587,55,24),
  ('takadanobaba','TAKADANOBABA',35.712677,139.703715,53,30),('shin-okubo','SHIN-OKUBO',35.701306,139.700044,52,37),
  ('shinjuku','SHINJUKU',35.689592,139.700413,52,44),('yoyogi','YOYOGI',35.683061,139.702042,53,48),
  ('harajuku','HARAJUKU',35.670168,139.702689,53,56),('shibuya','SHIBUYA',35.658034,139.701636,53,64),
  ('ebisu','EBISU',35.646690,139.710106,56,71),('meguro','MEGURO',35.633998,139.715828,58,79),
  ('gotanda','GOTANDA',35.626446,139.723444,61,84),('osaki','OSAKI',35.619700,139.728553,63,88),
  ('shinagawa','SHINAGAWA',35.628471,139.738760,67,82),('takanawa-gateway','TAKANAWA GATEWAY',35.635500,139.740700,68,78),
  ('tamachi','TAMACHI',35.645736,139.747575,71,71),('hamamatsucho','HAMAMATSUCHO',35.655646,139.756749,75,65),
  ('shimbashi','SHIMBASHI',35.666195,139.758587,76,59),('yurakucho','YURAKUCHO',35.675069,139.763328,77,53)
)
insert into public.tag_spots(id,area_id,name,latitude,longitude,map_x,map_y,radius_m,active,network,station_code)
select 'spot-'||id,id,romanized||' TAG SPOT',latitude,longitude,map_x,map_y,150,true,'yamanote',id from stations
on conflict(id) do update set area_id=excluded.area_id,name=excluded.name,latitude=excluded.latitude,
  longitude=excluded.longitude,map_x=excluded.map_x,map_y=excluded.map_y,radius_m=150,active=true,
  network='yamanote',station_code=excluded.station_code;

update public.profiles set interested_in=case gender when 'man' then 'woman' when 'woman' then 'man' else null end
where interested_in is null or interested_in not in('man','woman');

create or replace function public.normalize_profile_interest()
returns trigger language plpgsql set search_path=public as $$
begin
  new.interested_in:=case new.gender when 'man' then 'woman' when 'woman' then 'man' else null end;
  return new;
end $$;

drop trigger if exists normalize_profile_interest_before_write on public.profiles;
create trigger normalize_profile_interest_before_write before insert or update of gender,interested_in on public.profiles
for each row execute function public.normalize_profile_interest();

create or replace function public.profiles_are_mutually_interested(p_a uuid,p_b uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select a.gender in('man','woman') and b.gender in('man','woman')
    and a.gender<>b.gender and a.interested_in=b.gender and b.interested_in=a.gender
    from public.profiles a cross join public.profiles b where a.user_id=p_a and b.user_id=p_b),false)
$$;

create or replace function public.enforce_profile_like_eligibility()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.profiles_are_mutually_interested(new.sender_id,new.receiver_id) then
    raise exception 'profile preference mismatch';
  end if;
  return new;
end $$;

drop trigger if exists discovery_like_preference_guard on public.discovery_likes;
create trigger discovery_like_preference_guard before insert or update on public.discovery_likes
for each row execute function public.enforce_profile_like_eligibility();

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
    where sa.status='active' and sa.expires_at>now() and sb.expires_at>now()
      and abs(extract(epoch from(la.captured_at-lb.captured_at)))<=least(greatest(p_overlap_minutes,1),10)*60
      and public.profiles_are_mutually_interested(sa.user_id,sb.user_id)
      and public.distance_meters(la.latitude,la.longitude,lb.latitude,lb.longitude)<=
        least(greatest(p_radius_meters,100),1000)*case when exists(
          select 1 from public.active_boosts ab where ab.user_id in(sa.user_id,sb.user_id) and ab.expires_at>now()
        ) then 1.5 else 1 end
      and(select count(*) from public.user_tags a join public.user_tags b on b.tag_id=a.tag_id where a.user_id=sa.user_id and b.user_id=sb.user_id)>=5
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((sa.user_id,sb.user_id),(sb.user_id,sa.user_id)))
      and not exists(select 1 from public.crossings c where c.user_a=least(sa.user_id,sb.user_id) and c.user_b=greatest(sa.user_id,sb.user_id) and c.crossed_at>now()-interval '6 hours')
  ),inserted as(
    insert into public.crossings(user_a,user_b,area_label,crossed_at)
      select distinct user_a,user_b,area_label,date_trunc('minute',crossed_at) from candidate_pairs on conflict do nothing returning 1
  )select count(*) into created_count from inserted;
  return created_count;
end $$;

create or replace function public.get_area_activity_stats()
returns table(area_id text,total_exp bigint,participant_count bigint,my_rank bigint)
language sql stable security definer set search_path=public as $$
  with me as(select public.current_app_user_id() user_id)
  select a.id,coalesce(sum(c.points),0)::bigint,count(c.user_id)::bigint,
    coalesce((select ranked.rank from(
      select ac.user_id,row_number() over(order by ac.points desc,ac.updated_at) rank
      from public.area_contributions ac where ac.area_id=a.id
    ) ranked cross join me where ranked.user_id=me.user_id),0)::bigint
  from public.areas a left join public.area_contributions c on c.area_id=a.id
  where a.active group by a.id order by a.id
$$;

create or replace function public.message_history_limit()
returns integer language sql immutable as $$select 120$$;

create or replace function public.send_match_message(p_match_id uuid,p_body text)
returns table(id bigint,match_id uuid,sender_id uuid,body text,created_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_sender uuid;v_other uuid;v_body text;v_message public.messages%rowtype;
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
  insert into public.messages(match_id,sender_id,body) values(p_match_id,v_sender,v_body) returning * into v_message;
  delete from public.messages where messages.id in(
    select old.id from public.messages old where old.match_id=p_match_id order by old.created_at desc,old.id desc offset public.message_history_limit()
  );
  return query select v_message.id,v_message.match_id,v_message.sender_id,v_message.body,v_message.created_at,v_message.read_at;
end $$;

revoke all on function public.profiles_are_mutually_interested(uuid,uuid) from public,anon,authenticated;
revoke all on function public.detect_crossings_private(integer,integer) from public,anon,authenticated;
revoke all on function public.get_area_activity_stats() from public;
revoke all on function public.message_history_limit() from public,anon;
grant execute on function public.detect_crossings_private(integer,integer) to service_role;
grant execute on function public.get_area_activity_stats() to authenticated;
grant execute on function public.message_history_limit() to authenticated;
