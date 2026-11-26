-- Phase 4a: cut-over from Desk365. Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.
-- Nothing in here converts anything by itself: the conversion only happens when someone runs
--     select * from public.cutover_desk365_tickets(true);      -- from the Supabase SQL editor, on cut-over day
-- A dry run (no argument, or false) only reports what it WOULD do.
--
-- What the conversion does
--   * Copies the still-open Desk365 tickets (default statuses Open, Pending, Resolved) from the read-only archive
--     (desk365_tickets) into the working table (tickets), KEEPING their Desk365 numbers, dates, priority, category,
--     assignee (unassigned if that person is no longer active staff), contact and description.
--   * Sends NO notifications (the queue is switched off for the duration).
--   * Hides the archive copy of every converted ticket from the list (all_tickets), so nothing shows twice.
--   * Closed Desk365 tickets stay in the archive: searchable, read-only. Replies/notes are not part of the data.
--   * Optionally (p_continue_numbering) makes the next new ticket #<highest Desk365 number + 1> instead of #100001.
--     Refused if tickets already exist with the 100001+ numbers.
--   * Human Resources / onboarding tickets keep their rules (admins, assignee only; the creator shows as 'desk365-import').

-- 1. The archive copy disappears once a ticket has been converted. The helper bypasses row-level security on purpose,
--    so a ticket someone cannot see in `tickets` can never reappear from its older archive copy.
create or replace function public.native_ticket_numbers() returns bigint[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ticket_number), '{}'::bigint[]) from public.tickets;
$$;
revoke all on function public.native_ticket_numbers() from public, anon;
grant execute on function public.native_ticket_numbers() to authenticated;

drop view if exists public.all_tickets;
create view public.all_tickets with (security_invoker = true) as
  select ticket_number::bigint as ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email,
         created_on at time zone 'UTC' as created_on, updated_on at time zone 'UTC' as updated_on,
         'desk365'::text as origin
    from public.desk365_tickets
   where not (ticket_number::bigint = any ((select public.native_ticket_numbers())::bigint[]))
  union all
  select ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email, created_on, updated_on, 'native'::text
    from public.tickets;
grant select on public.all_tickets to authenticated;
revoke all on public.all_tickets from anon;

-- 2. Notifications can be silenced for one transaction (used by the conversion).
create or replace function public.enqueue_ticket_notification(p_ticket bigint, p_kind text, p_recipient text, p_actor text, p_excerpt text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r text := lower(coalesce(p_recipient, ''));
  subj text;
begin
  if coalesce(current_setting('app.skip_notifications', true), '') = 'on' then return; end if;
  if r = '' or r = lower(coalesce(p_actor, '')) then return; end if;
  if not exists (select 1 from public.staff s where s.email = r and s.active and s.notify_email) then return; end if;
  select t.subject into subj from public.tickets t where t.ticket_number = p_ticket;
  insert into public.ticket_notifications (ticket_number, kind, recipient_email, actor, ticket_subject, excerpt)
  values (p_ticket, p_kind, r, coalesce(p_actor, 'system'), coalesce(subj, ''), left(p_excerpt, 300));
end;
$$;
revoke all on function public.enqueue_ticket_notification(bigint, text, text, text, text) from public, anon, authenticated;

-- 3. The conversion itself.
create or replace function public.cutover_desk365_tickets(
  p_apply boolean default false,
  p_statuses text[] default array['Open', 'Pending', 'Resolved'],
  p_continue_numbering boolean default false
) returns table (step text, tickets bigint)
language plpgsql security definer set search_path = '' as $$
declare
  converted bigint := 0;
  next_no bigint;
begin
  drop table if exists pg_temp._cands;
  create temp table _cands on commit drop as
    select d.* from public.desk365_tickets d
     where d.status = any (p_statuses)
       and d.status in ('Open', 'Pending', 'Resolved', 'Closed')
       and not (d.ticket_number::bigint = any (public.native_ticket_numbers()));

  step := 'tickets to convert (status ' || array_to_string(p_statuses, ', ') || ')'; tickets := (select count(*) from pg_temp._cands); return next;
  step := '  of which assigned to someone no longer active staff (will become unassigned)';
  tickets := (select count(*) from pg_temp._cands c where c.assigned_to is not null and not exists (select 1 from public.staff s where s.email = lower(c.assigned_to) and s.active)); return next;
  step := '  of which Human Resources / onboarding (stay admin and assignee only)';
  tickets := (select count(*) from pg_temp._cands c where c.category = 'Human Resources' or c.form_name = 'New Hire Onboarding'); return next;
  step := 'next new ticket number if continue-numbering is chosen';
  tickets := greatest((select coalesce(max(ticket_number), 0) from public.desk365_tickets), (select coalesce(max(ticket_number), 0) from public.tickets where ticket_number < 100000)) + 1; return next;

  if not p_apply then
    step := 'DRY RUN: nothing was changed. Run with true to convert.'; tickets := 0; return next;
    return;
  end if;

  if p_continue_numbering and exists (select 1 from public.tickets where ticket_number >= 100000 and source <> 'desk365') then
    raise exception 'Tickets numbered 100001+ already exist; keep that numbering (do not use continue-numbering).';
  end if;

  perform set_config('app.skip_notifications', 'on', true);   -- no emails for converted tickets (this transaction only)

  insert into public.tickets (ticket_number, subject, description, status, priority, category, assigned_to, created_by,
                              contact_name, contact_email, source, created_on, updated_on, due_date, resolved_on, closed_on, first_response_on)
  overriding system value
  select c.ticket_number,
         left(coalesce(nullif(btrim(c.subject), ''), '(no subject)'), 300),
         left(coalesce(c.description_text, ''), 20000),
         c.status,
         case when c.priority in (1, 5, 10, 20) then c.priority else 5 end,
         case when exists (select 1 from public.ticket_categories k where k.name = c.category) then c.category end,
         case when exists (select 1 from public.staff s where s.email = lower(c.assigned_to) and s.active) then lower(c.assigned_to) end,
         'desk365-import',
         c.contact_name, lower(c.contact_email), 'desk365',
         c.created_on at time zone 'UTC', c.updated_on at time zone 'UTC', c.due_date at time zone 'UTC',
         c.resolved_on at time zone 'UTC', c.closed_on at time zone 'UTC', c.first_response_time at time zone 'UTC'
    from pg_temp._cands c;
  get diagnostics converted = row_count;
  step := 'CONVERTED'; tickets := converted; return next;

  if p_continue_numbering then
    next_no := greatest((select coalesce(max(ticket_number), 0) from public.desk365_tickets), (select coalesce(max(ticket_number), 0) from public.tickets)) + 1;
    execute format('alter table public.tickets alter column ticket_number restart with %s', next_no);
    step := 'next new ticket will be number'; tickets := next_no; return next;
  end if;
end;
$$;
revoke all on function public.cutover_desk365_tickets(boolean, text[], boolean) from public, anon, authenticated;
grant execute on function public.cutover_desk365_tickets(boolean, text[], boolean) to service_role;
