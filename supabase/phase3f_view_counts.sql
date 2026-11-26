-- Phase 3f: counts for the quick-filter pills at the top of the ticket list. Applied to `gulfcoast-tickets`. Safe to re-run.
-- SECURITY INVOKER: counts what the signed-in person is allowed to see (row-level security applies), nothing more.
--   "active" = Open or Pending.   mine = active tickets assigned to the caller.   urgent = active and priority High/Urgent.
create or replace function public.ticket_view_counts() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'all',        count(*),
    'open',       count(*) filter (where status = 'Open'),
    'pending',    count(*) filter (where status = 'Pending'),
    'resolved',   count(*) filter (where status = 'Resolved'),
    'closed',     count(*) filter (where status = 'Closed'),
    'mine',       count(*) filter (where status in ('Open', 'Pending') and assigned_to = lower(coalesce(auth.jwt() ->> 'email', ''))),
    'unassigned', count(*) filter (where status in ('Open', 'Pending') and assigned_to is null),
    'urgent',     count(*) filter (where status in ('Open', 'Pending') and priority >= 10)
  )
  from public.all_tickets;
$$;
revoke all on function public.ticket_view_counts() from public, anon;
grant execute on function public.ticket_view_counts() to authenticated;
