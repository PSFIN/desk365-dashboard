-- Phase 3a: native ticket creation. Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.
-- Needs phase1_access.sql (staff, is_staff, is_staff_admin). The Desk365 archive (desk365_tickets) is untouched.
--
-- * public.tickets          new tickets, numbered from 100001 (Desk365 numbers are < 10,000 for years to come)
-- * public.ticket_categories the category list for the form (seeded from the archive)
-- * public.all_tickets       archive + new tickets in one view for the list (security_invoker: RLS still applies)
-- * public.staff_directory() names/emails of active staff, for the "assign to" drop-down
--
-- Who can do what:  create = any active staff; read = admins, or staff for everything except Human Resources
-- (HR tickets are also visible to their creator and assignee). Nobody can edit or delete from the browser yet.

create table if not exists public.ticket_categories (
  name       text primary key,
  sort_order integer not null default 100,
  active     boolean not null default true
);
alter table public.ticket_categories enable row level security;
drop policy if exists ticket_categories_select on public.ticket_categories;
create policy ticket_categories_select on public.ticket_categories for select to authenticated using (public.is_staff());
grant select on public.ticket_categories to authenticated;
grant all on public.ticket_categories to service_role;
revoke all on public.ticket_categories from anon;

insert into public.ticket_categories (name, sort_order) values
  ('Maintenance', 10), ('Inspection/Cleaning/Pool Heat Request', 20), ('Accounting', 30),
  ('Sales & Revenue Management', 40), ('Customer Service', 50), ('OTA Management', 60),
  ('Marketing', 70), ('Account Management', 80), ('HOA Management', 90),
  ('Business Development Management', 100), ('Human Resources', 110), ('Technology Request', 120), ('Other', 200)
on conflict (name) do nothing;

create table if not exists public.tickets (
  ticket_number bigint generated always as identity (start with 100001) primary key,
  subject       text not null check (length(btrim(subject)) between 1 and 300),
  description   text not null default '' check (length(description) <= 20000),
  status        text not null default 'Open' check (status in ('Open', 'Pending', 'Resolved', 'Closed')),
  priority      integer not null default 5 check (priority in (1, 5, 10, 20)),   -- 1 Low, 5 Medium, 10 High, 20 Urgent
  category      text references public.ticket_categories (name) on update cascade,
  assigned_to   text check (assigned_to = lower(assigned_to)),
  created_by    text not null check (created_by = lower(created_by)),
  contact_name  text,
  contact_email text,
  source        text not null default 'web',
  created_on    timestamptz not null default now(),
  updated_on    timestamptz not null default now(),
  due_date      timestamptz,
  resolved_on   timestamptz,
  closed_on     timestamptz
);
create index if not exists tickets_status_idx   on public.tickets (status);
create index if not exists tickets_assigned_idx on public.tickets (assigned_to);
create index if not exists tickets_created_idx  on public.tickets (created_on desc);
create index if not exists tickets_creator_idx  on public.tickets (created_by);

-- On insert from a signed-in user the server decides who created it, when, and the starting state: the
-- browser cannot spoof the creator or back-date a ticket. Also validates the assignee.
create or replace function public.tickets_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  my_name text;
begin
  if me <> '' then
    new.created_by  := me;
    new.created_on  := now();
    new.updated_on  := now();
    new.status      := 'Open';
    new.source      := 'web';
    new.resolved_on := null;
    new.closed_on   := null;
  end if;
  if new.created_by is null or new.created_by = '' then
    raise exception 'created_by is required';
  end if;
  new.subject     := btrim(new.subject);
  new.assigned_to := nullif(lower(btrim(coalesce(new.assigned_to, ''))), '');
  if new.assigned_to is not null
     and not exists (select 1 from public.staff s where s.email = new.assigned_to and s.active) then
    raise exception 'assigned_to must be an active staff member';
  end if;
  select s.full_name into my_name from public.staff s where s.email = new.created_by;
  new.contact_name  := coalesce(nullif(btrim(coalesce(new.contact_name, '')), ''), my_name);
  new.contact_email := coalesce(nullif(lower(btrim(coalesce(new.contact_email, ''))), ''), new.created_by);
  return new;
end;
$$;
revoke all on function public.tickets_before_insert() from public, anon, authenticated;

drop trigger if exists tickets_before_insert on public.tickets;
create trigger tickets_before_insert before insert on public.tickets
  for each row execute function public.tickets_before_insert();

alter table public.tickets enable row level security;

drop policy if exists tickets_native_select on public.tickets;
create policy tickets_native_select on public.tickets for select to authenticated
  using (
    public.is_staff_admin()
    or (public.is_staff() and coalesce(category, '') <> 'Human Resources')
    or (public.is_staff() and (created_by = lower(coalesce(auth.jwt() ->> 'email', ''))
                               or assigned_to = lower(coalesce(auth.jwt() ->> 'email', ''))))
  );

drop policy if exists tickets_native_insert on public.tickets;
create policy tickets_native_insert on public.tickets for insert to authenticated
  with check (public.is_staff() and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));

grant select, insert on public.tickets to authenticated;
grant all on public.tickets to service_role;
revoke all on public.tickets from anon;

-- One list for the page: Desk365 archive + new tickets. Native times are converted to the account's local
-- time so both kinds line up (the archive stores local time without a zone).
create or replace view public.all_tickets with (security_invoker = true) as
  select ticket_number::bigint as ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email, created_on, updated_on, 'desk365'::text as origin
    from public.desk365_tickets
  union all
  select ticket_number, subject, status, priority, assigned_to, category,
         contact_name, contact_email,
         created_on at time zone 'America/New_York', updated_on at time zone 'America/New_York', 'native'::text
    from public.tickets;
grant select on public.all_tickets to authenticated;
revoke all on public.all_tickets from anon;

-- Filter drop-downs now cover both.
create or replace function public.ticket_filter_options() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'status',   coalesce((select jsonb_agg(v order by v) from (select distinct status      v from public.all_tickets where status      is not null) x), '[]'::jsonb),
    'category', coalesce((select jsonb_agg(v order by v) from (select distinct category    v from public.all_tickets where category    is not null) x), '[]'::jsonb),
    'assigned', coalesce((select jsonb_agg(v order by v) from (select distinct assigned_to v from public.all_tickets where assigned_to is not null) x), '[]'::jsonb),
    'group',    coalesce((select jsonb_agg(v order by v) from (select distinct group_name  v from public.desk365_tickets where group_name is not null) x), '[]'::jsonb)
  );
$$;

-- For the "assign to" drop-down: every signed-in staff member may see the names of active colleagues.
create or replace function public.staff_directory() returns table (email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select s.email, s.full_name from public.staff s where s.active and public.is_staff() order by lower(coalesce(s.full_name, s.email));
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;
