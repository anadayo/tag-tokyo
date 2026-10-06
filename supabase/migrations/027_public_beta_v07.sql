-- TAG TOKYO public beta v0.7: adult signup precheck, bounded chat history,
-- four lightweight reactions and dormant-account filtering.

create or replace function public.safe_adult_birth_date(p_value text)
returns date language plpgsql stable set search_path=public as $$
declare v_date date;
begin
  if coalesce(trim(p_value),'')='' then return null;end if;
  begin v_date:=p_value::date;exception when others then return null;end;
  if v_date>current_date-interval '20 years' or v_date<date '1900-01-01' then return null;end if;
  return v_date;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_birth_date date;
begin
  v_birth_date:=public.safe_adult_birth_date(new.raw_user_meta_data->>'birth_date');
  insert into public.users(auth_user_id,email,birth_date) values(new.id,new.email,v_birth_date)
  on conflict(auth_user_id) do update set
    email=excluded.email,
    birth_date=coalesce(public.users.birth_date,excluded.birth_date);
  return new;
end $$;

create or replace function public.set_my_birth_date(p_birth_date date)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;v_existing date;
begin
  v_user:=public.current_app_user_id();
  if v_user is null then raise exception 'authenticated user required';end if;
  if p_birth_date is null or p_birth_date>current_date-interval '20 years' or p_birth_date<date '1900-01-01' then
    raise exception 'service is available only to users aged 20 or older';
  end if;
  select birth_date into v_existing from public.users where id=v_user for update;
  if v_existing is not null and v_existing<>p_birth_date then raise exception 'birth date cannot be changed';end if;
  update public.users set birth_date=p_birth_date where id=v_user;
end $$;

alter table public.message_reactions drop constraint if exists message_reactions_reaction_check;
update public.message_reactions set reaction=case reaction when 'sparkle' then 'wow' when 'smile' then 'laugh' when 'thanks' then 'like' else reaction end;
alter table public.message_reactions add constraint message_reactions_reaction_check check(reaction in('heart','like','laugh','wow'));

create or replace function public.react_to_message(p_message_id bigint,p_reaction text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  v_user:=public.current_app_user_id();
  if p_reaction not in('heart','like','laugh','wow') then raise exception 'invalid reaction';end if;
  if not exists(select 1 from public.messages msg join public.matches m on m.id=msg.match_id
    where msg.id=p_message_id and m.ended_at is null and v_user in(m.user_a,m.user_b)) then raise exception 'active match required';end if;
  insert into public.message_reactions(message_id,user_id,reaction) values(p_message_id,v_user,p_reaction)
    on conflict(message_id,user_id) do update set reaction=excluded.reaction,created_at=now();
end $$;

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
    select old.id from public.messages old where old.match_id=p_match_id order by old.created_at desc,old.id desc offset 120
  );
  return query select v_message.id,v_message.match_id,v_message.sender_id,v_message.body,v_message.created_at,v_message.read_at;
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
      and coalesce(u.last_seen_at,u.created_at)>now()-interval '90 days'
      and((v_gender='man' and p.gender='woman')or(v_gender='woman' and p.gender='man'))
      and u.terms_accepted_at is not null and u.privacy_accepted_at is not null
      and not exists(select 1 from public.blocks b where(b.blocker_id,b.blocked_id) in((v_viewer,u.id),(u.id,v_viewer)))
      and not exists(select 1 from public.matches m where v_viewer in(m.user_a,m.user_b) and u.id in(m.user_a,m.user_b)
        and(m.ended_at is null or m.ended_at>now()-interval '30 days'))
  )
  select c.id,c.display_name,c.handle,c.bio,null::text,c.role='owner',c.liked,c.tags,c.primaries,c.common_count,
    case when c.last_seen_at>now()-interval '3 days' then 'recent' else 'away' end,
    round(((c.common_count/greatest(1,sqrt(c.tag_count::numeric)))+c.rare_score)::numeric,3) as score
  from candidates c where c.common_count>=5
  order by score desc,c.last_seen_at desc nulls last
  limit least(greatest(coalesce(p_limit,24),1),50);
end $$;

revoke all on function public.safe_adult_birth_date(text) from public,anon;
revoke all on function public.set_my_birth_date(date) from public,anon;
grant execute on function public.set_my_birth_date(date) to authenticated;
