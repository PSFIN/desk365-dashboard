-- Phase 0 archive of Desk365 tickets. Run once in the Supabase SQL editor.
-- Contains personal/HR data (some custom fields), so Row Level Security is ON with NO policies:
-- only the service-role key (server-side scripts) can read or write. Never expose the anon key to it.

create table if not exists public.desk365_tickets (
  ticket_number          integer primary key,
  subject                text,
  status                 text,
  priority               integer,
  type                   text,
  source                 integer,
  assigned_to            text,
  group_name             text,
  category               text,
  subcategory            text,
  contact_name           text,
  contact_email          text,
  company_name           text,
  form_name              text,
  sla                    text,
  completed_within_sla   boolean,
  conversation_count     integer,
  -- Desk365 timestamps have no timezone in the API output (account timezone, shown as EDT in the app)
  created_on             timestamp,
  updated_on             timestamp,
  due_date               timestamp,
  resolved_on            timestamp,
  closed_on              timestamp,
  first_response_time    timestamp,
  first_assigned_time    timestamp,
  closed_duration        bigint,
  resolved_duration      bigint,
  first_replied_duration bigint,
  first_assigned_duration bigint,
  watchers               jsonb,
  share_to               jsonb,
  custom_fields          jsonb,      -- cf_* fields with a value, keys without the cf_ prefix
  description            text,       -- HTML as stored in Desk365
  description_text       text,
  raw                    jsonb not null,   -- the complete API record, so nothing is lost
  archived_at            timestamptz not null default now()
);

create index if not exists desk365_tickets_status_idx      on public.desk365_tickets (status);
create index if not exists desk365_tickets_assigned_idx    on public.desk365_tickets (assigned_to);
create index if not exists desk365_tickets_created_idx     on public.desk365_tickets (created_on);
create index if not exists desk365_tickets_category_idx    on public.desk365_tickets (category);

alter table public.desk365_tickets enable row level security;
-- (deliberately no policies: anon and authenticated roles get no access)
