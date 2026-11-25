-- Phase 1b: AI meeting notes (from the gulf-coast-notes worker) visible in the Meetings tab.
-- Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run. Needs phase1_access.sql first.
--
-- Privacy: notes are private to the people who attended. A signed-in staff member can read a meeting
-- only if their email is in attendee_emails. There is deliberately NO admin override. Transcripts are
-- NOT stored here (only the recap); they stay on the notes server.
-- The worker writes with the service_role key, which bypasses RLS.

create table if not exists public.meeting_notes (
  key             text primary key,          -- same key as the worker's data/<key>.json
  title           text not null,
  ended_at        timestamptz not null,
  speakers        jsonb not null default '[]'::jsonb,
  recap           jsonb not null,            -- {summary, topics[], decisions[], action_items[], open_questions[]}
  attendee_emails text[] not null default '{}',   -- lower-cased by the trigger below
  usage           jsonb,                     -- Claude tokens/cost for writing the notes
  synced_at       timestamptz not null default now()
);

-- The access policy compares against the signed-in email in lower case, so store emails lower-cased.
create or replace function public.meeting_notes_lower_emails() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.attendee_emails := coalesce((select array_agg(distinct lower(e)) from unnest(new.attendee_emails) e), '{}');
  return new;
end;
$$;
revoke all on function public.meeting_notes_lower_emails() from public, anon, authenticated;

drop trigger if exists meeting_notes_lower_emails on public.meeting_notes;
create trigger meeting_notes_lower_emails before insert or update on public.meeting_notes
  for each row execute function public.meeting_notes_lower_emails();

create index if not exists meeting_notes_ended_idx     on public.meeting_notes (ended_at desc);
create index if not exists meeting_notes_attendees_idx on public.meeting_notes using gin (attendee_emails);

alter table public.meeting_notes enable row level security;

drop policy if exists meeting_notes_select on public.meeting_notes;
create policy meeting_notes_select on public.meeting_notes for select to authenticated
  using (
    public.is_staff()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = any (attendee_emails)
  );

grant select on public.meeting_notes to authenticated;
grant all    on public.meeting_notes to service_role;
revoke all   on public.meeting_notes from anon;
