-- Phase 1c: daily staff sync (run by the gulf-coast-notes server from Microsoft 365).
-- Applied to the `gulfcoast-tickets` Supabase project. Safe to re-run. Needs phase1_access.sql first.
--
-- source           'sync' = managed by the daily sync; 'manual' = added by hand (never deactivated by the sync)
-- inactive_reason  'left' = the sync deactivated this person because they left the licensed list.
--                  The sync only ever reactivates rows with reason 'left', so a manual block is never undone.
-- Admins (is_admin) are never deactivated by the sync.

alter table public.staff
  add column if not exists source          text not null default 'manual' check (source in ('manual', 'sync')),
  add column if not exists inactive_reason text,
  add column if not exists synced_at       timestamptz;

grant select, insert, update on public.staff to service_role;

-- People loaded from the Microsoft 365 staff list before the sync existed become sync-managed.
update public.staff set source = 'sync', synced_at = coalesce(synced_at, now()) where source = 'manual';
