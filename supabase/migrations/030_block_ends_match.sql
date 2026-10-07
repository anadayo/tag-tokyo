-- Blocking must immediately remove every active interaction surface.

create or replace function public.block_match_member(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path=public as $$
declare
  v_actor uuid;
  v_other uuid;
  v_crossing uuid;
begin
  v_actor:=public.current_app_user_id();
  if v_actor is null then raise exception 'authenticated user required';end if;

  select case when m.user_a=v_actor then m.user_b else m.user_a end,m.crossing_id
    into v_other,v_crossing
  from public.matches m
  where m.id=p_match_id and m.ended_at is null and v_actor in(m.user_a,m.user_b)
  for update;

  if v_other is null then raise exception 'active match not found';end if;

  insert into public.blocks(blocker_id,blocked_id) values(v_actor,v_other)
    on conflict do nothing;
  update public.matches set ended_at=now(),ended_by=v_actor where id=p_match_id;
  delete from public.discovery_likes
    where(sender_id,receiver_id) in((v_actor,v_other),(v_other,v_actor));
  if v_crossing is not null then
    delete from public.likes where crossing_id=v_crossing;
  end if;
end $$;

revoke all on function public.block_match_member(uuid) from public,anon;
grant execute on function public.block_match_member(uuid) to authenticated;
