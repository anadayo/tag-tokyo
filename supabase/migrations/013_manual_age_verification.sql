-- Manual age verification with short-lived, private evidence.
-- Applicants should mask every field except age/date of birth, document name,
-- and issuing authority before upload. Evidence is deleted after review.

create table if not exists public.age_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  object_path text not null unique check (char_length(object_path) between 38 and 240),
  document_type text not null check (document_type in ('drivers_license', 'passport', 'residence_card', 'other')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  delete_by timestamptz not null default (now() + interval '7 days'),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id),
  review_note text not null default '' check (char_length(review_note) <= 300),
  evidence_deleted_at timestamptz,
  constraint age_verification_review_state check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)
  )
);

create unique index if not exists age_verification_one_pending_per_user
  on public.age_verification_requests (user_id) where status = 'pending';
create index if not exists age_verification_review_queue
  on public.age_verification_requests (status, submitted_at);
create index if not exists age_verification_evidence_cleanup
  on public.age_verification_requests (delete_by) where evidence_deleted_at is null;

create table if not exists public.age_verification_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.age_verification_requests(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  action text not null check (action in ('viewed', 'approved', 'rejected', 'evidence_deleted', 'cleanup_deleted')),
  created_at timestamptz not null default now()
);
create index if not exists age_verification_audit_request_created
  on public.age_verification_audit (request_id, created_at);

alter table public.age_verification_requests enable row level security;
alter table public.age_verification_audit enable row level security;

drop policy if exists age_verification_self_read on public.age_verification_requests;
create policy age_verification_self_read on public.age_verification_requests for select
  using (user_id = public.current_app_user_id());

drop policy if exists age_verification_moderator_read on public.age_verification_requests;
create policy age_verification_moderator_read on public.age_verification_requests for select
  using (public.is_moderator());

-- No direct writes: state transitions must pass through audited RPCs.
revoke insert, update, delete on public.age_verification_requests from authenticated;
revoke insert, update, delete on public.age_verification_audit from authenticated;

drop policy if exists age_verification_audit_moderator_read on public.age_verification_audit;
create policy age_verification_audit_moderator_read on public.age_verification_audit for select
  using (public.is_moderator());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'age-verification-evidence',
  'age-verification-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists age_evidence_owner_insert on storage.objects;
create policy age_evidence_owner_insert on storage.objects for insert with check (
  bucket_id = 'age-verification-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists age_evidence_owner_read on storage.objects;
create policy age_evidence_owner_read on storage.objects for select using (
  bucket_id = 'age-verification-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_moderator()
  )
);

drop policy if exists age_evidence_owner_delete on storage.objects;
create policy age_evidence_owner_delete on storage.objects for delete using (
  bucket_id = 'age-verification-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_moderator()
  )
);

create or replace function public.submit_age_verification(
  p_object_path text,
  p_document_type text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_request uuid;
begin
  select * into v_user
  from public.users
  where auth_user_id = auth.uid() and status = 'active' and not is_demo
  for update;

  if v_user.id is null then raise exception 'authenticated member required'; end if;
  if v_user.terms_accepted_at is null or v_user.privacy_accepted_at is null then
    raise exception 'terms and privacy consent required';
  end if;
  if v_user.age_verification_status = 'verified' then raise exception 'age already verified'; end if;
  if p_document_type not in ('drivers_license', 'passport', 'residence_card', 'other') then
    raise exception 'unsupported document type';
  end if;
  if p_object_path not like auth.uid()::text || '/%' or char_length(p_object_path) > 240 then
    raise exception 'invalid evidence path';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'age-verification-evidence' and name = p_object_path and owner_id = auth.uid()::text
  ) then
    raise exception 'evidence upload not found';
  end if;
  if exists (select 1 from public.age_verification_requests where user_id = v_user.id and status = 'pending') then
    raise exception 'verification already pending';
  end if;

  insert into public.age_verification_requests (user_id, object_path, document_type)
  values (v_user.id, p_object_path, p_document_type)
  returning id into v_request;

  update public.users set
    age_verified = false,
    age_verification_status = 'pending',
    age_verified_at = null,
    age_verification_method = null,
    age_verification_reference = null
  where id = v_user.id;

  return v_request;
end;
$$;

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

  return v_request.object_path;
end;
$$;

create or replace function public.record_age_verification_view(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  if not public.is_moderator() then raise exception 'moderator access required'; end if;
  select id into v_actor from public.users where auth_user_id = auth.uid() and status = 'active';
  if not exists (select 1 from public.age_verification_requests where id = p_request_id and evidence_deleted_at is null) then
    raise exception 'verification evidence unavailable';
  end if;
  insert into public.age_verification_audit (request_id, actor_id, action)
  values (p_request_id, v_actor, 'viewed');
end;
$$;

create or replace function public.mark_age_evidence_deleted(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then raise exception 'moderator access required'; end if;
  update public.age_verification_requests
    set evidence_deleted_at = coalesce(evidence_deleted_at, now())
    where id = p_request_id and status <> 'pending';
  if not found then raise exception 'reviewed verification request not found'; end if;
  insert into public.age_verification_audit (request_id, actor_id, action)
  select p_request_id, id, 'evidence_deleted'
  from public.users where auth_user_id = auth.uid() and status = 'active';
end;
$$;

revoke all on function public.submit_age_verification(text, text) from public, anon;
revoke all on function public.review_age_verification(uuid, boolean, text) from public, anon;
revoke all on function public.record_age_verification_view(uuid) from public, anon;
revoke all on function public.mark_age_evidence_deleted(uuid) from public, anon;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.submit_age_verification(text, text) to authenticated;
grant execute on function public.review_age_verification(uuid, boolean, text) to authenticated;
grant execute on function public.record_age_verification_view(uuid) to authenticated;
grant execute on function public.mark_age_evidence_deleted(uuid) to authenticated;
