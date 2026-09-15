-- Owner access is assigned manually with the service role. Clients cannot promote themselves.
alter table public.users
  add column if not exists role text not null default 'member'
  check (role in ('member', 'owner'));

create or replace function public.owner_unlock_cosmetics()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select id into v_user from public.users
    where auth_user_id = auth.uid() and status = 'active' and role = 'owner';
  if v_user is null then raise exception 'owner access required'; end if;

  insert into public.user_cosmetics (user_id, cosmetic_id, source)
    select v_user, id, 'owner_access' from public.cosmetics where active
  on conflict do nothing;
end $$;

revoke all on function public.owner_unlock_cosmetics() from public, anon;
grant execute on function public.owner_unlock_cosmetics() to authenticated;

-- Run once from the Supabase SQL editor after the owner's first magic-link login:
-- update public.users set role = 'owner'
-- where auth_user_id = (select id from auth.users where email = 'OWNER_EMAIL');
