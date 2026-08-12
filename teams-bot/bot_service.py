"""
Runs on the always-on Windows PC, exposed to the internet via a Cloudflare Tunnel.

Two endpoints:
  POST /api/messages      Bot Framework calls this for every event (installs, replies, etc).
                           On "bot added for a user" it looks up that user's email via the
                           Teams roster API and stores their conversation reference locally,
                           so we can message them later without them saying anything first.
  POST /api/send-overdue  GitHub Actions calls this daily with {assignee_email: [tickets]}.
                           Bearer-token protected. Looks up each assignee's stored conversation
                           reference and sends them a proactive Teams message.

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

adapter_settings = BotFrameworkAdapterSettings(APP_ID, APP_PASSWORD, channel_auth_tenant=APP_TENANT_ID)
adapter = BotFrameworkAdapter(adapter_settings)


def load_refs() -> dict:
    if REFS_FILE.exists():
        return json.loads(REFS_FILE.read_text())
    return {}


def save_refs(refs: dict) -> None:
    REFS_FILE.write_text(json.dumps(refs, indent=2))


class ReminderBot(TeamsActivityHandler):
    async def on_teams_members_added(self, members_added, team_info, turn_context: TurnContext):
        for member in members_added:
            if member.id == turn_context.activity.recipient.id:
                continue  # that's the bot itself being added, not a person

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
    return jsonify({"status": "ok", "known_assignees": len(load_refs())})


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


def format_message(tickets: list) -> str:
    n = len(tickets)
    lines = [f"You have {n} overdue ticket{'s' if n != 1 else ''}:"]
    for t in tickets:
        lines.append(
            f"- #{t.get('ticket_number')} — {t.get('subject', '(no subject)')} — "
            f"{t.get('days_overdue', '?')} day(s) overdue — {t.get('url', '')}"
        )
    return "\n".join(lines)


@app.route("/api/send-overdue", methods=["POST"])
def send_overdue():
    if request.headers.get("Authorization") != f"Bearer {WEBHOOK_SECRET}":
        abort(401)

    payload = request.get_json(force=True, silent=True) or {}
    refs = load_refs()
    results = {}

    async def send_all():
        for email, tickets in payload.items():
            ref_dict = refs.get(email.lower())
            if not ref_dict:
                results[email] = "no_conversation_ref"
                log.warning("No conversation reference stored for %s — bot not installed for them yet?", email)
                continue

            reference = ConversationReference().deserialize(ref_dict)
            message = format_message(tickets)

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


if __name__ == "__main__":
    log.info("Starting bot_service on port %d (%d assignees known)", PORT, len(load_refs()))
    app.run(host="0.0.0.0", port=PORT)
