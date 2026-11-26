-- Phase 3e: Desk365's API times are UTC (staff create tickets between 13:00 and 21:00 stored = 9-5 Eastern),
-- not Eastern as first assumed. The archive columns stay as stored; the combined view now returns real
-- timestamps (timestamptz) for both kinds of ticket, and the page shows them in Eastern time.
-- Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.

drop view if exists public.all_tickets;
create view public.all_tickets with (security_invoker = true) as
  select ticket_number::bigint as ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email,
         created_on at time zone 'UTC' as created_on, updated_on at time zone 'UTC' as updated_on,
         'desk365'::text as origin
    from public.desk365_tickets
  union all
  select ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email, created_on, updated_on, 'native'::text
    from public.tickets;
grant select on public.all_tickets to authenticated;
revoke all on public.all_tickets from anon;

comment on column public.desk365_tickets.created_on is 'UTC, as returned by the Desk365 API (no zone in the value)';
comment on column public.desk365_tickets.updated_on is 'UTC, as returned by the Desk365 API (no zone in the value)';
