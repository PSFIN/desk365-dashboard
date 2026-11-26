-- Phase 3h: Trash. Applied to `gulfcoast-tickets`. Safe to re-run.
--
-- A ticket moved to Trash disappears from every list, count and chart, and shows only in the Trash view until someone
-- restores it. Nothing is ever deleted: the ticket row (Desk365 archive copy or native) is untouched, and every
-- trash / restore is kept as a history row (who, when). Works for Desk365 archive tickets and tickets made here, and
-- survives the Desk365 sync and the cut-over because it is keyed by ticket number in its own table.
-- Who may trash or restore: any staff member who can see that ticket (so Human Resources tickets stay admin / involved only).

-- 1. History + current state ---------------------------------------------------------------------------------------
create table if not exists public.ticket_trash (
  id            bigint generated always as identity primary key,
  ticket_number bigint not null,
  deleted_by    text   not null,
  deleted_at    timestamptz not null default now(),
  restored_by   text,
  restored_at   timestamptz
);
create unique index if not exists ticket_trash_one_active on public.ticket_trash (ticket_number) where restored_at is null;
create index if not exists ticket_trash_number_idx on public.ticket_trash (ticket_number);

-- 2. The combined list without the trash filter, then the live list and the trash list ------------------------------
create or replace view public.all_tickets_raw with (security_invoker = true) as
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
grant select on public.all_tickets_raw to authenticated;
revoke all on public.all_tickets_raw from anon;

-- Numbers currently in the trash. Bypasses row-level security on purpose (it only feeds a WHERE clause, so a ticket
-- someone cannot see never appears either way), same pattern as native_ticket_numbers().
create or replace function public.trashed_ticket_numbers() returns bigint[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ticket_number), '{}'::bigint[]) from public.ticket_trash where restored_at is null;
$$;
revoke all on function public.trashed_ticket_numbers() from public, anon;
grant execute on function public.trashed_ticket_numbers() to authenticated;

drop view if exists public.all_tickets;
create view public.all_tickets with (security_invoker = true) as
  select * from public.all_tickets_raw
   where not (ticket_number = any ((select public.trashed_ticket_numbers())::bigint[]));
grant select on public.all_tickets to authenticated;
revoke all on public.all_tickets from anon;

-- 3. Row-level security: you see / change a trash row only for tickets you can see --------------------------------
alter table public.ticket_trash enable row level security;

drop policy if exists ticket_trash_select on public.ticket_trash;
create policy ticket_trash_select on public.ticket_trash for select to authenticated
  using (public.is_staff() and exists (select 1 from public.all_tickets_raw r where r.ticket_number = ticket_trash.ticket_number));

drop policy if exists ticket_trash_insert on public.ticket_trash;
create policy ticket_trash_insert on public.ticket_trash for insert to authenticated
  with check (public.is_staff() and exists (select 1 from public.all_tickets_raw r where r.ticket_number = ticket_trash.ticket_number));

drop policy if exists ticket_trash_update on public.ticket_trash;
create policy ticket_trash_update on public.ticket_trash for update to authenticated
  using (public.is_staff() and restored_at is null and exists (select 1 from public.all_tickets_raw r where r.ticket_number = ticket_trash.ticket_number))
  with check (public.is_staff());

grant select, insert on public.ticket_trash to authenticated;
grant update (restored_at) on public.ticket_trash to authenticated;
grant all on public.ticket_trash to service_role;
revoke all on public.ticket_trash from anon;

-- The server records who and when; the browser cannot choose them.
create or replace function public.ticket_trash_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.deleted_by := me; new.deleted_at := now(); new.restored_by := null; new.restored_at := null;
  else
    new.deleted_by := old.deleted_by; new.deleted_at := old.deleted_at; new.ticket_number := old.ticket_number;
    new.restored_by := me; new.restored_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists ticket_trash_stamp on public.ticket_trash;
create trigger ticket_trash_stamp before insert or update on public.ticket_trash
  for each row execute function public.ticket_trash_stamp();

-- 4. The Trash list (same columns as all_tickets + who / when) --------------------------------------------------------
drop view if exists public.trashed_tickets;
create view public.trashed_tickets with (security_invoker = true) as
  select r.*, t.deleted_at, t.deleted_by
    from public.all_tickets_raw r
    join public.ticket_trash t on t.ticket_number = r.ticket_number and t.restored_at is null;
grant select on public.trashed_tickets to authenticated;
revoke all on public.trashed_tickets from anon;

-- 5. One call from the page each ------------------------------------------------------------------------------------
create or replace function public.trash_ticket(p_n bigint) returns void
language sql set search_path = '' as $$
  insert into public.ticket_trash (ticket_number, deleted_by) values (p_n, '') on conflict do nothing;
$$;
revoke all on function public.trash_ticket(bigint) from public, anon;
grant execute on function public.trash_ticket(bigint) to authenticated;

create or replace function public.restore_ticket(p_n bigint) returns void
language sql set search_path = '' as $$
  update public.ticket_trash set restored_at = now() where ticket_number = p_n and restored_at is null;
$$;
revoke all on function public.restore_ticket(bigint) from public, anon;
grant execute on function public.restore_ticket(bigint) to authenticated;

-- 6. Count for the side panel ------------------------------------------------------------------------------------------
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
    'trash',      (select count(*) from public.trashed_tickets),
    'cats',       (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb)
                     from (select category as c, count(*) as n from t where status in ('Open', 'Pending') and category is not null group by category) x)
  );
$$;
revoke all on function public.ticket_view_counts() from public, anon;
grant execute on function public.ticket_view_counts() to authenticated;
