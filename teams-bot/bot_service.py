"""
Runs on the always-on Windows PC, exposed to the internet via a Cloudflare Tunnel.

Three endpoints:
  POST /api/messages      Bot Framework calls this for every event (installs, replies, etc).
                           On "bot added for a user" it looks up that user's email via the
                           Teams roster API and stores their conversation reference locally,
                           so we can message them later without them saying anything first.
                           On "bot added to a team" (requires the "team" scope in the app
                           manifest, and someone adding the app to that team) it stores a
                           separate, team-level conversation reference instead.
  POST /api/send-overdue  GitHub Actions calls this daily with
                           {total_overdue, assignees: {email: {name, tickets}}}.
                           Bearer-token protected. Looks up each assignee's stored conversation
                           reference and sends them a proactive, personal Teams message.
  POST /api/post-channel  Bearer-token protected. Posts a plain message to every known team
                           channel (or one specific team, via {"team_id": ..., "message": ...}).
                           Used for one-off announcements rather than the daily per-person run.

See teams-bot/README.md for setup (Azure Bot resource, Cloudflare Tunnel, running this as a
persistent Windows service).
"""
import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, request, jsonify, abort
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings, TurnContext
from botbuilder.core.teams import TeamsActivityHandler, TeamsInfo
from botbuilder.schema import Activity, ConversationReference

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bot_service")

APP_ID = os.environ["BOT_APP_ID"]
APP_PASSWORD = os.environ["BOT_APP_PASSWORD"]
APP_TENANT_ID = os.environ["BOT_APP_TENANT_ID"]
WEBHOOK_SECRET = os.environ["REMINDER_WEBHOOK_SECRET"]
PORT = int(os.environ.get("PORT", 3978))

REFS_FILE = Path(__file__).parent / "conversation_refs.json"
CHANNEL_REFS_FILE = Path(__file__).parent / "channel_refs.json"

adapter_settings = BotFrameworkAdapterSettings(APP_ID, APP_PASSWORD, channel_auth_tenant=APP_TENANT_ID)
adapter = BotFrameworkAdapter(adapter_settings)


def load_refs() -> dict:
    if REFS_FILE.exists():
        return json.loads(REFS_FILE.read_text())
    return {}


def save_refs(refs: dict) -> None:
    REFS_FILE.write_text(json.dumps(refs, indent=2))


def load_channel_refs() -> dict:
    if CHANNEL_REFS_FILE.exists():
        return json.loads(CHANNEL_REFS_FILE.read_text())
    return {}


def save_channel_refs(refs: dict) -> None:
    CHANNEL_REFS_FILE.write_text(json.dumps(refs, indent=2))


class ReminderBot(TeamsActivityHandler):
    async def on_teams_members_added(self, members_added, team_info, turn_context: TurnContext):
        for member in members_added:
            if member.id == turn_context.activity.recipient.id:
                # The bot itself being added. In a team context (team_info set) that means
                # someone just added the app to a team — store a channel-level conversation
                # reference so we can post announcements there later. In a personal context
                # there's nothing else to do here.
                if team_info:
                    reference = TurnContext.get_conversation_reference(turn_context.activity)
                    refs = load_channel_refs()
                    refs[team_info.id] = reference.serialize()
                    save_channel_refs(refs)
                    log.info("Stored channel conversation reference for team %s", team_info.id)
                    await turn_context.send_activity(
                        "Thanks for adding me here — I can now post updates to this channel."
                    )
                continue

            email = None
            try:
                teams_member = await TeamsInfo.get_member(turn_context, member.id)
                email = (teams_member.email or teams_member.user_principal_name or "").lower() or None
            except Exception as e:
                log.warning("Couldn't resolve email for member %s: %s", member.id, e)

            if not email:
                await turn_context.send_activity(
                    "I couldn't determine your email address, so I can't sign you up for "
                    "overdue ticket reminders. Please contact IT."
                )
                continue

            reference = TurnContext.get_conversation_reference(turn_context.activity)
            refs = load_refs()
            refs[email] = reference.serialize()
            save_refs(refs)
            log.info("Stored conversation reference for %s", email)

            await turn_context.send_activity(
                "You're set up — I'll send you a daily Teams message here listing any of your "
                "overdue Desk365 tickets."
            )


bot = ReminderBot()
app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "known_assignees": len(load_refs()),
        "known_channels": len(load_channel_refs()),
    })


@app.route("/api/messages", methods=["POST"])
def messages():
    body = request.get_json(force=True, silent=True)
    if body is None:
        abort(400)

    activity = Activity().deserialize(body)
    auth_header = request.headers.get("Authorization", "")

    async def call_adapter():
        await adapter.process_activity(activity, auth_header, bot.on_turn)

    try:
        asyncio.run(call_adapter())
    except Exception as e:
        log.exception("Error processing activity")
        return jsonify({"error": str(e)}), 500

    return jsonify({}), 201


def format_message(name: str, tickets: list, total_overdue: int) -> str:
    first_name = name.split()[0] if name else "there"
    n = len(tickets)

    if n:
        lines = [
            f"Hi {first_name}, hope your week's going well!",
            "",
            f"Just a quick nudge — {'this one could' if n == 1 else 'these could'} use some attention:",
            "",
        ]
        for t in tickets:
            lines.append(
                f"- #{t.get('ticket_number')} — {t.get('subject', '(no subject)')} — "
                f"{t.get('days_overdue', '?')} day(s) overdue — {t.get('url', '')}"
            )
        lines += [
            "",
            f"On the bright side, we've brought overdue tickets down from 100+ to just "
            f"{total_overdue} company-wide — every one you close helps keep that going.",
            "",
            "Anything blocking you? Just give your manager a shout.",
        ]
    else:
        lines = [
            f"Hi {first_name} — nothing overdue on your end right now. Nice work staying on top of it!",
            "",
            f"({total_overdue} left company-wide, down from 100+ — the team's making good progress.)",
        ]
    return "\n".join(lines)


@app.route("/api/send-overdue", methods=["POST"])
def send_overdue():
    if request.headers.get("Authorization") != f"Bearer {WEBHOOK_SECRET}":
        abort(401)

    payload = request.get_json(force=True, silent=True) or {}
    assignees = payload.get("assignees", {})
    total_overdue = payload.get("total_overdue", sum(len(a.get("tickets", [])) for a in assignees.values()))
    refs = load_refs()
    results = {}

    async def send_all():
        for email, info in assignees.items():
            tickets = info.get("tickets", [])
            name = info.get("name", "")
            ref_dict = refs.get(email.lower())

            if not ref_dict:
                # First message for a brand-new install: the Graph install call and this
                # request can both fire before Teams' conversationUpdate callback (which is
                # what actually stores the reference) has landed on /api/messages. Poll
                # briefly rather than failing immediately — observed delay is ~2-3s.
                for _ in range(8):
                    await asyncio.sleep(1)
                    ref_dict = load_refs().get(email.lower())
                    if ref_dict:
                        log.info("Conversation reference for %s arrived after waiting", email)
                        break

            if not ref_dict:
                results[email] = "no_conversation_ref"
                log.warning("No conversation reference stored for %s — bot not installed for them yet?", email)
                continue

            reference = ConversationReference().deserialize(ref_dict)
            message = format_message(name, tickets, total_overdue)

            async def callback(turn_context: TurnContext, _message=message):
                await turn_context.send_activity(_message)

            try:
                await adapter.continue_conversation(reference, callback, APP_ID)
                results[email] = "sent"
                log.info("Sent overdue reminder to %s (%d tickets)", email, len(tickets))
            except Exception as e:
                results[email] = f"error: {e}"
                log.exception("Failed to send to %s", email)

    asyncio.run(send_all())
    return jsonify(results), 200


@app.route("/api/post-channel", methods=["POST"])
def post_channel():
    if request.headers.get("Authorization") != f"Bearer {WEBHOOK_SECRET}":
        abort(401)

    payload = request.get_json(force=True, silent=True) or {}
    message = (payload.get("message") or "").strip()
    if not message:
        abort(400)

    refs = load_channel_refs()
    team_id = payload.get("team_id")
    if team_id:
        refs = {team_id: refs[team_id]} if team_id in refs else {}
    results = {}

    async def post_all():
        for tid, ref_dict in refs.items():
            reference = ConversationReference().deserialize(ref_dict)

            async def callback(turn_context: TurnContext, _message=message):
                await turn_context.send_activity(_message)

            try:
                await adapter.continue_conversation(reference, callback, APP_ID)
                results[tid] = "sent"
                log.info("Posted to channel/team %s", tid)
            except Exception as e:
                results[tid] = f"error: {e}"
                log.exception("Failed to post to channel/team %s", tid)

    asyncio.run(post_all())
    return jsonify(results), 200


if __name__ == "__main__":
    log.info(
        "Starting bot_service on port %d (%d assignees, %d channels known)",
        PORT, len(load_refs()), len(load_channel_refs()),
    )
    app.run(host="0.0.0.0", port=PORT)
