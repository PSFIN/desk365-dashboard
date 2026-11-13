-- Phase 1: who may read the archived Desk365 tickets from the browser.
-- Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run.
--
-- Model: people sign in with Supabase Auth (magic link by email). A signed-in person can read data
-- only if their email is on public.staff (and active). Admins see every ticket; other staff do not
-- see HR / onboarding tickets. The anon role (not signed in) can read nothing. The service_role key
-- (server-side scripts only) still bypasses all of this.

create table if not exists public.staff (
  email      text primary key check (email = lower(email)),
  full_name  text,
  is_admin   boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

-- Helper functions. SECURITY DEFINER so they can read public.staff regardless of the caller's RLS;
-- search_path is pinned; only signed-in users may call them.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.active and s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_staff_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.active and s.is_admin and s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_staff(), public.is_staff_admin() from public, anon;
grant execute on function public.is_staff(), public.is_staff_admin() to authenticated;

-- staff: a person can see their own row; admins can see everyone.
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_staff_admin());

-- tickets: admins read everything; other staff read everything except HR / onboarding tickets.
drop policy if exists tickets_select on public.desk365_tickets;
create policy tickets_select on public.desk365_tickets for select to authenticated
  using (
    public.is_staff_admin()
    or (
      public.is_staff()
      and coalesce(category, '') <> 'Human Resources'
      and coalesce(form_name, '') <> 'New Hire Onboarding'
    )
  );

grant select on public.staff to authenticated;
grant select on public.desk365_tickets to authenticated;
revoke all on public.staff, public.desk365_tickets from anon;

-- Values for the filter drop-downs. SECURITY INVOKER (default), so RLS applies to the caller.
create or replace function public.ticket_filter_options() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'status',   coalesce((select jsonb_agg(v order by v) from (select distinct status      v from public.desk365_tickets where status      is not null) x), '[]'::jsonb),
    'category', coalesce((select jsonb_agg(v order by v) from (select distinct category    v from public.desk365_tickets where category    is not null) x), '[]'::jsonb),
    'assigned', coalesce((select jsonb_agg(v order by v) from (select distinct assigned_to v from public.desk365_tickets where assigned_to is not null) x), '[]'::jsonb),
    'group',    coalesce((select jsonb_agg(v order by v) from (select distinct group_name  v from public.desk365_tickets where group_name  is not null) x), '[]'::jsonb)
  );
$$;
revoke all on function public.ticket_filter_options() from public, anon;
grant execute on function public.ticket_filter_options() to authenticated;
