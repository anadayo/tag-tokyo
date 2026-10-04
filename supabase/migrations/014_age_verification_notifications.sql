-- Queue transactional email after a manual age-verification decision.
-- Recipient addresses remain in public.users/Supabase Auth and are not copied
-- into this operational queue.

create table if not exists public.age_verification_notifications (
  id bigint generated always as identity primary key,
  request_id uuid not null unique references public.age_verification_requests(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  template text not null check (template in ('age_verification_approved', 'age_verification_rejected')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  last_error text not null default '' check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists age_verification_notifications_dispatch
  on public.age_verification_notifications (status, created_at);

alter table public.age_verification_notifications enable row level security;
revoke insert, update, delete on public.age_verification_notifications from authenticated;

drop policy if exists age_verification_notifications_moderator_read on public.age_verification_notifications;
create policy age_verification_notifications_moderator_read
  on public.age_verification_notifications for select using (public.is_moderator());

create or replace function public.review_age_verification(
  p_request_id uuid,
  p_approved boolean,
  p_note text default ''
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_request public.age_verification_requests%rowtype;
  v_status text;
begin
  if not public.is_moderator() then raise exception 'moderator access required'; end if;
  select id into v_actor from public.users where auth_user_id = auth.uid() and status = 'active';
  select * into v_request from public.age_verification_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'verification request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'verification request already reviewed'; end if;

  v_status := case when p_approved then 'approved' else 'rejected' end;
  update public.age_verification_requests set
    status = v_status,
    reviewed_at = now(),
    reviewed_by = v_actor,
    review_note = left(coalesce(p_note, ''), 300)
  where id = p_request_id;

  insert into public.age_verification_audit (request_id, actor_id, action)
  values (p_request_id, v_actor, v_status);

  if p_approved then
    update public.users set
      age_verified = true,
      age_verification_status = 'verified',
      age_verified_at = now(),
      age_verification_method = 'manual_document_review',
      age_verification_reference = p_request_id::text
    where id = v_request.user_id;
  else
    update public.users set
      age_verified = false,
      age_verification_status = 'rejected',
      age_verified_at = null,
      age_verification_method = null,
      age_verification_reference = null
    where id = v_request.user_id;
  end if;

  insert into public.age_verification_notifications (request_id, user_id, template)
  values (
    p_request_id,
    v_request.user_id,
    case when p_approved then 'age_verification_approved' else 'age_verification_rejected' end
  );

  return v_request.object_path;
end;
$$;

revoke all on function public.review_age_verification(uuid, boolean, text) from public, anon;
grant execute on function public.review_age_verification(uuid, boolean, text) to authenticated;
