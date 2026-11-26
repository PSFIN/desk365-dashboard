-- Phase 3g: dashboard numbers + "mark resolved" for meeting items. Applied to `gulfcoast-tickets`. Safe to re-run.
--
-- 1. all_tickets also returns resolved_on / closed_on (needed for "closed per period" and "time to close").
-- 2. ticket_view_counts() also returns `active` (Open+Pending) and per-category active counts (for the side panel).
-- 3. ticket_dashboard(p_days): every number behind the dashboard charts, in one call. SECURITY INVOKER, so row-level
--    security applies: each person's charts only count tickets they are allowed to see.
-- 4. meeting_item_status + set_meeting_item(): attendees can mark a meeting's action items / open questions resolved.

-- 1 ---------------------------------------------------------------------------------------------------------------
drop view if exists public.all_tickets;
create view public.all_tickets with (security_invoker = true) as
  select ticket_number::bigint as ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email,
         created_on at time zone 'UTC' as created_on, updated_on at time zone 'UTC' as updated_on,
         resolved_on at time zone 'UTC' as resolved_on, closed_on at time zone 'UTC' as closed_on,
         'desk365'::text as origin
    from public.desk365_tickets
   where not (ticket_number::bigint = any ((select public.native_ticket_numbers())::bigint[]))
  union all
  select ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email, created_on, updated_on, resolved_on, closed_on, 'native'::text
    from public.tickets;
grant select on public.all_tickets to authenticated;
revoke all on public.all_tickets from anon;

-- 2 ---------------------------------------------------------------------------------------------------------------
create or replace function public.ticket_view_counts() returns jsonb
language sql stable set search_path = '' as $$
  with t as (select status, priority, assigned_to, category from public.all_tickets)
  select jsonb_build_object(
    'all',        (select count(*) from t),
    'active',     (select count(*) from t where status in ('Open', 'Pending')),
    'open',       (select count(*) from t where status = 'Open'),
    'pending',    (select count(*) from t where status = 'Pending'),
    'resolved',   (select count(*) from t where status = 'Resolved'),
    'closed',     (select count(*) from t where status = 'Closed'),
    'mine',       (select count(*) from t where status in ('Open', 'Pending') and assigned_to = lower(coalesce(auth.jwt() ->> 'email', ''))),
    'unassigned', (select count(*) from t where status in ('Open', 'Pending') and assigned_to is null),
    'urgent',     (select count(*) from t where status in ('Open', 'Pending') and priority >= 10),
    'cats',       (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb)
                     from (select category as c, count(*) as n from t where status in ('Open', 'Pending') and category is not null group by category) x)
  );
$$;
revoke all on function public.ticket_view_counts() from public, anon;
grant execute on function public.ticket_view_counts() to authenticated;

-- 3 ---------------------------------------------------------------------------------------------------------------
-- p_days: 7 / 30 / 90 -> daily buckets; 365 -> weekly; 0 (all time) -> monthly. Days are Eastern-time days.
create or replace function public.ticket_dashboard(p_days integer default 30) returns jsonb
language sql stable set search_path = '' as $$
  with t as materialized (
    select ticket_number, subject, status, priority, category, assigned_to, created_on,
           coalesce(closed_on, resolved_on) as done_on
      from public.all_tickets
  ),
  cfg as (
    select case when coalesce(p_days, 0) <= 0 then null else now() - make_interval(days => p_days) end as since,
           case when coalesce(p_days, 0) <= 0 then null else now() - make_interval(days => 2 * p_days) end as prev_since,
           case when coalesce(p_days, 0) <= 0 then 'month' when p_days <= 90 then 'day' else 'week' end as gran
  ),
  act as (select * from t where status in ('Open', 'Pending')),
  buckets as (
    select b::date as d
      from cfg, generate_series(
             date_trunc(cfg.gran, (coalesce(cfg.since, (select min(created_on) from t), now()) at time zone 'America/New_York'))::date,
             (now() at time zone 'America/New_York')::date,
             case cfg.gran when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end) b
  ),
  created_by_bucket as (
    select date_trunc(cfg.gran, t.created_on at time zone 'America/New_York')::date as d, count(*) as n
      from t, cfg where cfg.since is null or t.created_on >= cfg.since group by 1
  ),
  closed_by_bucket as (
    select date_trunc(cfg.gran, t.done_on at time zone 'America/New_York')::date as d, count(*) as n
      from t, cfg where t.done_on is not null and (cfg.since is null or t.done_on >= cfg.since) group by 1
  )
  select jsonb_build_object(
    'gran',   (select gran from cfg),
    'since',  (select (since at time zone 'America/New_York')::date from cfg),
    'totals', jsonb_build_object(
        'all',        (select count(*) from t),
        'active',     (select count(*) from act),
        'open',       (select count(*) from t where status = 'Open'),
        'pending',    (select count(*) from t where status = 'Pending'),
        'resolved',   (select count(*) from t where status = 'Resolved'),
        'closed',     (select count(*) from t where status = 'Closed'),
        'unassigned', (select count(*) from act where assigned_to is null),
        'urgent',     (select count(*) from act where priority >= 10),
        'mine',       (select count(*) from act where assigned_to = lower(coalesce(auth.jwt() ->> 'email', '')))),
    'period', jsonb_build_object(
        'created',      (select count(*) from t, cfg where cfg.since is null or t.created_on >= cfg.since),
        'created_prev', (select count(*) from t, cfg where cfg.since is not null and t.created_on >= cfg.prev_since and t.created_on < cfg.since),
        'closed',       (select count(*) from t, cfg where t.done_on is not null and (cfg.since is null or t.done_on >= cfg.since)),
        'closed_prev',  (select count(*) from t, cfg where cfg.since is not null and t.done_on >= cfg.prev_since and t.done_on < cfg.since),
        'median_days_to_close', (select round((percentile_cont(0.5) within group (order by extract(epoch from (t.done_on - t.created_on)) / 86400.0))::numeric, 1)
                                   from t, cfg where t.done_on is not null and t.done_on >= t.created_on and (cfg.since is null or t.done_on >= cfg.since))),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('k', status, 'n', n) order by n desc), '[]'::jsonb)
                    from (select status, count(*) as n from t group by status) x),
    'by_priority_active', (select coalesce(jsonb_agg(jsonb_build_object('k', priority, 'n', n) order by priority desc), '[]'::jsonb)
                    from (select priority, count(*) as n from act group by priority) x),
    'by_category_period', (select coalesce(jsonb_agg(jsonb_build_object('k', category, 'n', n) order by n desc), '[]'::jsonb)
                    from (select coalesce(t.category, '(none)') as category, count(*) as n from t, cfg
                           where cfg.since is null or t.created_on >= cfg.since group by 1 order by n desc limit 10) x),
    'by_assignee_active', (select coalesce(jsonb_agg(jsonb_build_object('k', assigned_to, 'n', n) order by n desc), '[]'::jsonb)
                    from (select assigned_to, count(*) as n from act group by assigned_to order by n desc limit 9) x),
    'age_active', (select jsonb_build_array(
                      jsonb_build_object('k', 'Today',        'n', count(*) filter (where d = today),                              'lo', 0,  'hi', 0),
                      jsonb_build_object('k', '1-3 days',     'n', count(*) filter (where d between today - 3 and today - 1),     'lo', 1,  'hi', 3),
                      jsonb_build_object('k', '4-7 days',     'n', count(*) filter (where d between today - 7 and today - 4),     'lo', 4,  'hi', 7),
                      jsonb_build_object('k', '8-30 days',    'n', count(*) filter (where d between today - 30 and today - 8),    'lo', 8,  'hi', 30),
                      jsonb_build_object('k', 'Over 30 days', 'n', count(*) filter (where d < today - 30),                        'lo', 31, 'hi', null))
                    from (select (created_on at time zone 'America/New_York')::date as d, (now() at time zone 'America/New_York')::date as today from act) x),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('d', b.d, 'created', coalesce(c.n, 0), 'closed', coalesce(x.n, 0)) order by b.d), '[]'::jsonb)
                from buckets b left join created_by_bucket c on c.d = b.d left join closed_by_bucket x on x.d = b.d),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object('n', ticket_number, 'subject', subject, 'priority', priority, 'created_on', created_on, 'assigned_to', assigned_to)), '[]'::jsonb)
                    from (select * from act where priority >= 10 order by priority desc, created_on asc limit 6) a)
  );
$$;
revoke all on function public.ticket_dashboard(integer) from public, anon;
grant execute on function public.ticket_dashboard(integer) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------------------------
create table if not exists public.meeting_item_status (
  meeting_key text not null references public.meeting_notes (key) on delete cascade,
  kind        text not null check (kind in ('action', 'question')),
  idx         integer not null check (idx >= 0),          -- position inside the recap's action_items / open_questions
  resolved    boolean not null default true,
  resolved_by text,
  resolved_at timestamptz,
  primary key (meeting_key, kind, idx)
);
alter table public.meeting_item_status enable row level security;

drop policy if exists meeting_item_status_select on public.meeting_item_status;
create policy meeting_item_status_select on public.meeting_item_status for select to authenticated
  using (exists (select 1 from public.meeting_notes m where m.key = meeting_item_status.meeting_key));   -- attendees only (RLS on meeting_notes)

drop policy if exists meeting_item_status_insert on public.meeting_item_status;
create policy meeting_item_status_insert on public.meeting_item_status for insert to authenticated
  with check (public.is_staff() and exists (select 1 from public.meeting_notes m where m.key = meeting_item_status.meeting_key));

drop policy if exists meeting_item_status_update on public.meeting_item_status;
create policy meeting_item_status_update on public.meeting_item_status for update to authenticated
  using (exists (select 1 from public.meeting_notes m where m.key = meeting_item_status.meeting_key))
  with check (public.is_staff());

grant select, insert on public.meeting_item_status to authenticated;
grant update (resolved) on public.meeting_item_status to authenticated;
grant all on public.meeting_item_status to service_role;
revoke all on public.meeting_item_status from anon;

-- The server records who resolved it and when.
create or replace function public.meeting_item_status_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.resolved_by := case when new.resolved then lower(coalesce(auth.jwt() ->> 'email', '')) else null end;
  new.resolved_at := case when new.resolved then now() else null end;
  return new;
end;
$$;
drop trigger if exists meeting_item_status_stamp on public.meeting_item_status;
create trigger meeting_item_status_stamp before insert or update on public.meeting_item_status
  for each row execute function public.meeting_item_status_stamp();

-- One call from the page: resolve or re-open an item. SECURITY INVOKER: the policies above decide who may.
create or replace function public.set_meeting_item(p_key text, p_kind text, p_idx integer, p_resolved boolean) returns void
language sql set search_path = '' as $$
  insert into public.meeting_item_status (meeting_key, kind, idx, resolved) values (p_key, p_kind, p_idx, p_resolved)
  on conflict (meeting_key, kind, idx) do update set resolved = excluded.resolved;
$$;
revoke all on function public.set_meeting_item(text, text, integer, boolean) from public, anon;
grant execute on function public.set_meeting_item(text, text, integer, boolean) to authenticated;
