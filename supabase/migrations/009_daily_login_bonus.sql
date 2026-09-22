-- Every real user starts at level 1. The first authenticated access each JST
-- calendar day can claim one server-issued bonus, never from the client.

create table public.daily_login_claims (
  user_id uuid not null references public.users(id) on delete cascade,
  claim_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  exp_awarded integer not null check (exp_awarded = 20),
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)
);

create or replace function public.claim_daily_login_bonus()
returns integer language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_date date; v_claimed integer;
begin
  v_user := public.current_app_user_id();
  perform public.assert_live_member(v_user);
  v_date := (now() at time zone 'Asia/Tokyo')::date;
  insert into public.daily_login_claims (user_id, claim_date, exp_awarded)
    values (v_user, v_date, 20)
    on conflict (user_id, claim_date) do nothing
    returning exp_awarded into v_claimed;
  if v_claimed is null then return 0; end if;
  perform public.issue_exp(v_user, v_claimed, 'achievement', 'daily_login', v_date::text);
  return v_claimed;
end $$;

alter table public.daily_login_claims enable row level security;
create policy daily_login_claims_self_read on public.daily_login_claims
  for select using (user_id = public.current_app_user_id());

revoke all on function public.claim_daily_login_bonus() from public, anon;
grant execute on function public.claim_daily_login_bonus() to authenticated;
