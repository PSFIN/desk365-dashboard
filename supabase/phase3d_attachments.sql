-- Phase 3d: attachments on tickets. Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.
-- Needs phase3a and phase3b.
--
-- * Storage bucket `ticket-attachments`: PRIVATE, 10 MB per file, a short list of safe file types
--   (no HTML, SVG, scripts or executables). Files are stored as  <ticket number>/<uuid>-<file name>.
-- * public.ticket_attachments: one row per file (who, when, name, size), optionally tied to a reply.
-- * Who may see / download / upload: exactly the staff who can see the ticket. Nobody can edit or delete
--   from the browser. Downloads use short-lived signed links.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments', 'ticket-attachments', false, 10485760,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- True when the object path starts with the number of a ticket the signed-in person can see.
-- (SECURITY INVOKER, so the ticket row-level security applies.)
create or replace function public.can_access_attachment_path(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select case when p_name ~ '^[0-9]{1,15}/'
              then exists (select 1 from public.tickets t where t.ticket_number = split_part(p_name, '/', 1)::bigint)
              else false end;
$$;
revoke all on function public.can_access_attachment_path(text) from public, anon;
grant execute on function public.can_access_attachment_path(text) to authenticated;

drop policy if exists ticket_attachments_objects_select on storage.objects;
create policy ticket_attachments_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and public.can_access_attachment_path(name));

drop policy if exists ticket_attachments_objects_insert on storage.objects;
create policy ticket_attachments_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and public.is_staff() and public.can_access_attachment_path(name));

create table if not exists public.ticket_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_number bigint not null references public.tickets (ticket_number) on delete cascade,
  activity_id   bigint references public.ticket_activity (id) on delete set null,
  file_name     text not null check (length(file_name) between 1 and 200),
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes between 0 and 10485760),
  storage_path  text not null unique,
  uploaded_by   text not null check (uploaded_by = lower(uploaded_by)),
  created_at    timestamptz not null default now()
);
create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments (ticket_number);

alter table public.ticket_attachments enable row level security;

drop policy if exists ticket_attachments_select on public.ticket_attachments;
create policy ticket_attachments_select on public.ticket_attachments for select to authenticated
  using (exists (select 1 from public.tickets t where t.ticket_number = ticket_attachments.ticket_number));

drop policy if exists ticket_attachments_insert on public.ticket_attachments;
create policy ticket_attachments_insert on public.ticket_attachments for insert to authenticated
  with check (
    public.is_staff()
    and uploaded_by = lower(coalesce(auth.jwt() ->> 'email', ''))
    and storage_path like ticket_number::text || '/%'
    and exists (select 1 from public.tickets t where t.ticket_number = ticket_attachments.ticket_number)
  );

grant select, insert on public.ticket_attachments to authenticated;
grant all on public.ticket_attachments to service_role;
revoke all on public.ticket_attachments from anon;

-- The server decides who uploaded and when.
create or replace function public.ticket_attachments_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me <> '' then new.uploaded_by := me; new.created_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists ticket_attachments_before_insert on public.ticket_attachments;
create trigger ticket_attachments_before_insert before insert on public.ticket_attachments
  for each row execute function public.ticket_attachments_before_insert();
