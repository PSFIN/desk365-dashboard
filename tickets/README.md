# Gulf Coast ticket system (replacement for Desk365)

A single page (`tickets/index.html`) backed by the Supabase project `gulfcoast-tickets`. No build step.
Sign-in is a magic link by email; what each person can do is decided by the database (row-level security),
not by the page. The page contains only Supabase's public key.

## What it does today

| Area | Status |
|---|---|
| Desk365 history (9,597 tickets, read-only archive) | Done. Search, filter, sort, open any ticket. |
| Create a ticket (subject, description, category, priority, assignee, contact, files) | Done. Numbers start at **100001**. |
| Work a ticket: reply, internal note, status, priority, category, assignee, due date, files | Done. Every change is logged in the conversation. |
| Meetings tab: AI notes from the meeting notes tool, private to attendees | Done. |
| Email notifications (assigned / reply / note / status) | Built, **switched off**. See "Notifications". |
| Receiving email into tickets (owners and guests writing in) | **Not built.** Needs read access to a shared mailbox. |
| SLA rules / reports / customer-facing portal | Not built. |

## Files

| File | What |
|---|---|
| `tickets/index.html` | The whole UI. |
| `supabase/phase1_access.sql` | Staff allow-list, helper functions, archive read access. |
| `supabase/phase1b_meetings.sql` | `meeting_notes` (private to attendees). |
| `supabase/phase1c_staff_sync.sql` | Columns for the daily Microsoft 365 staff sync. |
| `supabase/phase3a_tickets.sql` | `tickets`, `ticket_categories`, `all_tickets` view, `staff_directory()`. |
| `supabase/phase3b_workflow.sql` | `ticket_activity`, update rules, history, first-response time. |
| `supabase/phase3c_notifications.sql` | `ticket_notifications` queue (filled by triggers). |
| `supabase/phase3d_attachments.sql` | Private storage bucket + `ticket_attachments`. |

All SQL is already applied to the live project and is safe to re-run. The notes server (repo `gulf-coast-notes`)
does the Microsoft 365 work: daily staff sync, copying meeting recaps, and (when enabled) sending notifications.

## Who can do what

* **Staff list** (`public.staff`, kept up to date daily from Microsoft 365): only people on it can read anything.
* **Admins** (you, for now): see every ticket including Human Resources.
* **Other staff**: see every ticket except Human Resources (HR tickets are also visible to their creator and assignee).
* **Create / reply / note**: any staff member who can see the ticket. **Change status, priority, category, assignee,
  due date**: same. **Never changeable from the browser**: subject, description, creator, creation time.
* The server, not the page, sets who did something and when, so it can't be faked.
* **Files**: up to 5 per upload, 10 MB each; PDF, images, Word, Excel, PowerPoint, CSV, text only. Private bucket,
  60-second download links. Only people who can see the ticket can open its files.
* **Meetings**: only attendees, no admin override. Transcripts are never stored here.

## Notifications

The database only **queues** them. The notes server sends them from `notes@choosegulfcoast.com`, one email per person
per ticket per minute-check. It does nothing until `TICKET_NOTIFY=true` is set in that server's `.env`.
For a safe first trial set `TICKET_NOTIFY_ONLY=your@address` (everyone else's are marked "skipped"), and set
`TICKETS_URL` so emails link to the page. `npm run notify-tickets -- --dry-run` shows what would be sent.
Nobody is told about their own actions; people can opt out (`staff.notify_email = false`).

## What was tested (all in rolled-back transactions or the browser preview, no real people emailed)

* Access rules for: anonymous visitor, signed-in non-staff, normal staff, assignee, creator, admin (HR visibility,
  spoofed creator/status/date, invalid assignee, forged history entries, blank notes, editing locked columns).
* Notification queue: who is and isn't told (actor, self-assign, opted-out, inactive).
* Attachments: path rules, other-bucket / other-ticket / HR-ticket attempts, oversize records, bucket settings.
* The page, with a fake backend: create, reply, note, status / assignee changes, file checks, downloads, HTML
  in titles / replies shown as plain text.
* **Not tested with a real sign-in or a real file upload** (needs a magic-link email).

## Before real use (go-live checklist)

1. Give the page an address (for example `tickets.choosegulfcoast.com`) and add it under Supabase
   Authentication → URL Configuration → Redirect URLs. For a local test add `http://localhost:3000/**`.
2. Sign in once yourself and click through: create → reply → change status → attach a file → download it.
3. Decide how the two systems coexist. Tickets created here do **not** reach Desk365 and Desk365 tickets do not
   appear here after the archive. Pick a cut-over date or run a pilot team.
4. Turn on notifications with a pilot list first (above), then for everyone.
5. Decide on email-to-ticket (owners, guests, vendors). It is the largest piece still missing.
