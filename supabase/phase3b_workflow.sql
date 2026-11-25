-- Phase 3b: work a ticket: replies, internal notes, status / priority / category / assignee / due date changes,
-- and an automatic history. Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run. Needs phase3a.
--
-- * public.ticket_activity  replies and notes written by staff, plus automatic events (status changed, reassigned...)
-- * Staff who can SEE a ticket may reply/note on it and change status, priority, category, assignee and due date.
--   Subject, description, creator and creation time can never be changed from the browser.
-- * Server-managed: updated_on, resolved_on, closed_on, first_response_on, and the history entries.

-- Who may see a native ticket: admins; other staff unless it is Human Resources; HR also to creator and assignee.
create or replace function public.can_see_ticket(p_category text, p_created_by text, p_assigned_to text) returns boolean
language sql stable set search_path = '' as $$
  select public.is_staff_admin()
      or (public.is_staff() and coalesce(p_category, '') <> 'Human Resources')
      or (public.is_staff() and lower(coalesce(auth.jwt() ->> 'email', '')) in (p_created_by, p_assigned_to));
$$;
revoke all on function public.can_see_ticket(text, text, text) from public, anon;
grant execute on function public.can_see_ticket(text, text, text) to authenticated;

drop policy if exists tickets_native_select on public.tickets;
create policy tickets_native_select on public.tickets for select to authenticated
  using (public.can_see_ticket(category, created_by, assigned_to));

alter table public.tickets add column if not exists first_response_on timestamptz;

-- Working a ticket: only these columns can be changed from the browser.
drop policy if exists tickets_native_update on public.tickets;
create policy tickets_native_update on public.tickets for update to authenticated
  using (public.can_see_ticket(category, created_by, assigned_to))
  with check (public.is_staff());
revoke update on public.tickets from authenticated;
grant update (status, priority, category, assigned_to, due_date) on public.tickets to authenticated;

create table if not exists public.ticket_activity (
  id            bigint generated always as identity primary key,
  ticket_number bigint not null references public.tickets (ticket_number) on delete cascade,
  kind          text not null check (kind in ('reply', 'note', 'status', 'assignment', 'priority', 'category', 'due_date')),
  body          text not null default '' check (length(body) <= 20000),
  meta          jsonb,                         -- events: {"from": ..., "to": ...}
  actor         text not null check (actor = lower(actor)),
  created_at    timestamptz not null default now()
);
create index if not exists ticket_activity_ticket_idx on public.ticket_activity (ticket_number, created_at);

alter table public.ticket_activity enable row level security;

drop policy if exists ticket_activity_select on public.ticket_activity;
create policy ticket_activity_select on public.ticket_activity for select to authenticated
  using (exists (select 1 from public.tickets t where t.ticket_number = ticket_activity.ticket_number));  -- RLS on tickets applies

drop policy if exists ticket_activity_insert on public.ticket_activity;
create policy ticket_activity_insert on public.ticket_activity for insert to authenticated
  with check (
    public.is_staff()
    and kind in ('reply', 'note')
    and btrim(body) <> ''
    and actor = lower(coalesce(auth.jwt() ->> 'email', ''))
    and exists (select 1 from public.tickets t where t.ticket_number = ticket_activity.ticket_number)
  );

grant select, insert on public.ticket_activity to authenticated;
grant all on public.ticket_activity to service_role;
revoke all on public.ticket_activity from anon;

-- The server decides who wrote an entry and when.
create or replace function public.ticket_activity_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me <> '' then
    new.actor := me;
    new.created_at := now();
  end if;
  if new.actor is null or new.actor = '' then new.actor := 'system'; end if;
  return new;
end;
$$;
drop trigger if exists ticket_activity_before_insert on public.ticket_activity;
create trigger ticket_activity_before_insert before insert on public.ticket_activity
  for each row execute function public.ticket_activity_before_insert();

-- A new reply/note refreshes the ticket and records the first answer by someone other than the creator.
create or replace function public.ticket_activity_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('reply', 'note') then
    update public.tickets t
       set updated_on = now(),
           first_response_on = case when new.kind = 'reply' and new.actor <> t.created_by and t.first_response_on is null
                                    then now() else t.first_response_on end
     where t.ticket_number = new.ticket_number;
  end if;
  return new;
end;
$$;
revoke all on function public.ticket_activity_after_insert() from public, anon, authenticated;
drop trigger if exists ticket_activity_after_insert on public.ticket_activity;
create trigger ticket_activity_after_insert after insert on public.ticket_activity
  for each row execute function public.ticket_activity_after_insert();

-- Before a ticket is updated: validate the assignee, keep the timestamps right.
create or replace function public.tickets_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.assigned_to := nullif(lower(btrim(coalesce(new.assigned_to, ''))), '');
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null
     and not exists (select 1 from public.staff s where s.email = new.assigned_to and s.active) then
    raise exception 'assigned_to must be an active staff member';
  end if;
  new.updated_on := now();
  if new.status is distinct from old.status then
    if new.status = 'Resolved' then
      new.resolved_on := now(); new.closed_on := null;
    elsif new.status = 'Closed' then
      new.closed_on := now(); new.resolved_on := coalesce(old.resolved_on, now());
    else                                   -- reopened (Open / Pending)
      new.resolved_on := null; new.closed_on := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tickets_before_update() from public, anon, authenticated;
drop trigger if exists tickets_before_update on public.tickets;
create trigger tickets_before_update before update on public.tickets
  for each row execute function public.tickets_before_update();

-- After a ticket is updated: write the history.
create or replace function public.tickets_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if new.status is distinct from old.status then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'status', me, jsonb_build_object('from', old.status, 'to', new.status)); end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'assignment', me, jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to)); end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'priority', me, jsonb_build_object('from', old.priority, 'to', new.priority)); end if;
  if new.category is distinct from old.category then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'category', me, jsonb_build_object('from', old.category, 'to', new.category)); end if;
  if new.due_date is distinct from old.due_date then
    insert into public.ticket_activity (ticket_number, kind, actor, meta) values (new.ticket_number, 'due_date', me, jsonb_build_object('from', old.due_date, 'to', new.due_date)); end if;
  return new;
end;
$$;
revoke all on function public.tickets_after_update() from public, anon, authenticated;
drop trigger if exists tickets_after_update on public.tickets;
create trigger tickets_after_update after update on public.tickets
  for each row execute function public.tickets_after_update();
