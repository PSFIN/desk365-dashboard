# Gulf Coast ticket system (replacement for Desk365)

A single page (`tickets/index.html`) backed by the Supabase project `gulfcoast-tickets`. No build step.
Sign-in is a magic link by email; what each person can do is decided by the database (row-level security),
not by the page. The page contains only Supabase's public key.

## What it does today

| Area | Status |
|---|---|
| Desk365 history and live mirror (9,704 tickets so far) | Done. Search, filter, sort, open any ticket. A timer on the server copies new and changed Desk365 tickets every 10 minutes (see "Moving off Desk365"). |
| Create a ticket (subject, description, category, priority, assignee, contact, files) | Done. Numbers start at **100001**. |
| Work a ticket: reply, internal note, status, priority, category, assignee, due date, files | Done. Every change is logged in the conversation. |
| Meetings tab: AI notes from the meeting notes tool, private to attendees | Done. |
| Email notifications (assigned / reply / note / status) | Built, **switched off**. See "Notifications". |
| Receiving email into tickets / customer portal | **Not needed.** Owners, guests and vendors never create tickets; staff create them all. |
| SLA rules / reports | Not built. |

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
| `supabase/phase3e_timezones.sql` | Desk365 times are UTC; the combined view returns real timestamps. |
| `archive/sync_desk365.py` + `archive/deploy_sync.sh` | The Desk365 -> in-house mirror (runs on the server every 10 minutes). |
| `deploy/tickets/` | Caddy block + `deploy.sh` that publishes the page. |

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

## Where it runs

* Page: **https://tickets.choosegulfcoast.com** (Lightsail server, Caddy, automatic HTTPS). Publish changes with
  `deploy/tickets/deploy.sh`.
* Times: Desk365's API gives **UTC**; everything is shown in Eastern time.

## Moving off Desk365

1. **Mirror (now)**: staff keep working in Desk365. `desk365-sync.timer` on the server copies new and changed
   tickets into Supabase every 10 minutes (about 6 Desk365 calls an hour, well inside the allowance). Replies and
   notes written in Desk365 are NOT available through its API, so they are not copied (ask Desk365 for a full export).
   Tickets deleted or merged in Desk365 are not removed here.
2. **Pilot**: a small team works tickets natively (create, reply, assign) while everyone else stays in Desk365.
   Native tickets do not appear in Desk365, so only do this for a team that does not need to share tickets.
3. **Cut-over day** (`supabase/phase4a_cutover.sql`, already applied; nothing runs until someone calls it):
   1. Make sure staff have stopped working in Desk365; wait for one more sync (10 minutes) so the mirror is current.
   2. In the Supabase SQL editor: `select * from public.cutover_desk365_tickets();` is a **dry run** (counts only).
   3. `select * from public.cutover_desk365_tickets(true, array['Open','Pending','Resolved'], true);` converts those tickets into
      working tickets **keeping their Desk365 numbers** and dates, sends no emails, and makes the next new ticket #<highest + 1>
      (use `false` as the last argument to keep new tickets at #100001). Closed tickets stay in the searchable archive.
      It refuses the continue-numbering option if tickets numbered 100001+ already exist, and a second run converts nothing.
   4. Stop the mirror: `sudo systemctl disable --now desk365-sync.timer` on the server.
   5. Switch notifications on (see "Notifications"), and repoint anything that still reads Desk365 (the reminders bot and the
      ticket dashboards) at Supabase.

## Before real use

1. In Supabase, Authentication -> URL Configuration: add `https://tickets.choosegulfcoast.com/**` to Redirect URLs and
   set Site URL to `https://tickets.choosegulfcoast.com`. (For a local test also add `http://localhost:3000/**`.)
2. Sign in once yourself and click through: create -> reply -> change status -> attach a file -> download it.
3. Turn on notifications with a pilot list first (see "Notifications"), then for everyone.
