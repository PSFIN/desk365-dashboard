-- Phase 3c: ticket notifications (outbox). Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.
-- Needs phase3a and phase3b. Nothing here sends email: the database only QUEUES notifications in
-- public.ticket_notifications. The gulf-coast-notes server sends them (off by default, see that repo).
--
-- Who is told what (never the person who did the action, never inactive staff, never anyone who opted out):
--   assigned  -> the new assignee, when a ticket is created with / reassigned to them
--   reply     -> the ticket's creator and assignee
--   note      -> the assignee only (internal notes)
--   status    -> the ticket's creator and assignee
-- Recipients are always internal staff (public.staff), never an outside contact.

alter table public.staff add column if not exists notify_email boolean not null default true;

create table if not exists public.ticket_notifications (
  id              bigint generated always as identity primary key,
  ticket_number   bigint not null references public.tickets (ticket_number) on delete cascade,
  kind            text not null check (kind in ('assigned', 'reply', 'note', 'status')),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  actor           text not null,
  ticket_subject  text not null,
  excerpt         text,                                  -- start of the reply/note, or "Open -> Resolved"
  status          text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts        integer not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists ticket_notifications_pending_idx on public.ticket_notifications (status, id);

-- No browser access at all: only the server (service_role) reads and updates the outbox.
alter table public.ticket_notifications enable row level security;
revoke all on public.ticket_notifications from anon, authenticated;
grant all on public.ticket_notifications to service_role;

create or replace function public.enqueue_ticket_notification(p_ticket bigint, p_kind text, p_recipient text, p_actor text, p_excerpt text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r text := lower(coalesce(p_recipient, ''));
  subj text;
begin
  if r = '' or r = lower(coalesce(p_actor, '')) then return; end if;
  if not exists (select 1 from public.staff s where s.email = r and s.active and s.notify_email) then return; end if;
  select t.subject into subj from public.tickets t where t.ticket_number = p_ticket;
  insert into public.ticket_notifications (ticket_number, kind, recipient_email, actor, ticket_subject, excerpt)
  values (p_ticket, p_kind, r, coalesce(p_actor, 'system'), coalesce(subj, ''), left(p_excerpt, 300));
end;
$$;
revoke all on function public.enqueue_ticket_notification(bigint, text, text, text, text) from public, anon, authenticated;

-- A ticket created already assigned to someone.
create or replace function public.tickets_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not null then
    perform public.enqueue_ticket_notification(new.ticket_number, 'assigned', new.assigned_to, new.created_by, new.description);
  end if;
  return new;
end;
$$;
revoke all on function public.tickets_after_insert() from public, anon, authenticated;
drop trigger if exists tickets_after_insert on public.tickets;
create trigger tickets_after_insert after insert on public.tickets
  for each row execute function public.tickets_after_insert();

-- Replies / notes: history refresh (3b) plus notifications.
create or replace function public.ticket_activity_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if new.kind in ('reply', 'note') then
    update public.tickets x
       set updated_on = now(),
           first_response_on = case when new.kind = 'reply' and new.actor <> x.created_by and x.first_response_on is null
                                    then now() else x.first_response_on end
     where x.ticket_number = new.ticket_number
     returning x.created_by, x.assigned_to into t;
    if new.kind = 'reply' then
      perform public.enqueue_ticket_notification(new.ticket_number, 'reply', t.created_by, new.actor, new.body);
      if t.assigned_to is distinct from t.created_by then
        perform public.enqueue_ticket_notification(new.ticket_number, 'reply', t.assigned_to, new.actor, new.body);
      end if;
    else
      perform public.enqueue_ticket_notification(new.ticket_number, 'note', t.assigned_to, new.actor, new.body);
    end if;
  end if;
  return new;
end;
$$;

-- Ticket changes: history (3b) plus notifications for reassignment and status changes.
create or replace function public.tickets_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if new.status is distinct from old.status then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'status', me, jsonb_build_object('from', old.status, 'to', new.status));
    perform public.enqueue_ticket_notification(new.ticket_number, 'status', new.created_by, me, old.status || ' -> ' || new.status);
    if new.assigned_to is distinct from new.created_by then
      perform public.enqueue_ticket_notification(new.ticket_number, 'status', new.assigned_to, me, old.status || ' -> ' || new.status);
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'assignment', me, jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
    perform public.enqueue_ticket_notification(new.ticket_number, 'assigned', new.assigned_to, me, null);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'priority', me, jsonb_build_object('from', old.priority, 'to', new.priority)); end if;
  if new.category is distinct from old.category then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'category', me, jsonb_build_object('from', old.category, 'to', new.category)); end if;
  if new.due_date is distinct from old.due_date then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'due_date', me, jsonb_build_object('from', old.due_date, 'to', new.due_date)); end if;
  return new;
end;
$$;
