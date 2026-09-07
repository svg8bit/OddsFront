"""Remove recognized disputed-resolution broadcasts, without changing Drops settings."""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from channel_disputes import CHANNELS, disputed_alerts, public_messages

ROOT = Path("/root/OddsFront/.local/news/channel-moderation")


def atomic(path, data):
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def channel_page(channel):
    url = "https://t.me/s/" + channel
    with urlopen(Request(url, headers={"User-Agent": "OddsFrontChannelModeration/1.0"}), timeout=8) as response:
        final = urlparse(response.url)
        if final.scheme != "https" or final.hostname != "t.me" or final.path != "/s/" + channel:
            raise RuntimeError("Unexpected public channel redirect")
        content = response.read(1_048_577)
        if len(content) > 1_048_576:
            raise RuntimeError("Public channel response exceeds its size bound")
    messages = public_messages(content.decode("utf8"))
    if not any(row["post"].startswith(channel + "/") for row in messages):
        raise RuntimeError("Public channel messages are unavailable")
    return messages


def bot_token():
    direct = os.environ.get("ODDSFRONT_TELEGRAM_BOT_TOKEN")
    if direct:
        return direct
    file = os.environ.get("ODDSFRONT_TELEGRAM_CREDENTIAL_ENV")
    key = os.environ.get("ODDSFRONT_TELEGRAM_CREDENTIAL_KEY", "ODDSFRONT_TELEGRAM_BOT_TOKEN")
    if not file or not re.fullmatch(r"[A-Z_]+", key) or Path(file).stat().st_mode & 0o077:
        raise RuntimeError("The private named Telegram credential reference is unavailable")
    # Use only the publisher's already authorized named bot key. Never import
    # another environment, print it, or copy it into this project.
    with Path(file).open() as stream:
        for line in stream:
            if line.startswith(key + "="):
                token = line.split("=", 1)[1].strip().strip('"').strip("'")
                if re.fullmatch(r"[0-9]+:[\w-]+", token):
                    return token
    raise RuntimeError("The named bot key is missing")


def main():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / "moderation.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        apply = "--apply" in sys.argv
        state_file = ROOT / "state.json"
        state = json.loads(state_file.read_text()) if state_file.exists() else {"deleted": {}}
        candidates = []
        for channel in CHANNELS:
            rows = disputed_alerts(channel_page(channel), channel)
            candidates.extend((channel, row) for row in rows if row["post"] not in state["deleted"])
        if not apply or not candidates:
            atomic(ROOT / "latest.json", {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "check" if not apply else "healthy", "candidates": [row["post"] for _, row in candidates]})
            if not apply:
                print(json.dumps({"status": "check", "candidates": [row["post"] for _, row in candidates]}))
            return
        token = bot_token()

        def call(method, body):
            request = Request("https://api.telegram.org/bot" + token + "/" + method, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            try:
                with urlopen(request, timeout=8) as response:
                    data = json.load(response)
                if not data.get("ok"):
                    raise RuntimeError("Rejected bot request")
                return data["result"]
            except Exception:
                raise RuntimeError("Telegram " + method + " was not confirmed") from None

        bot = call("getMe", {})
        if bot.get("id") != 8783764515 or bot.get("username", "").lower() != "dropsanalyticsaibot":
            raise RuntimeError("Wrong moderator bot identity")
        allowed = set()
        for channel, row in candidates[:6]:
            chat_id = CHANNELS[channel]
            if channel not in allowed:
                chat = call("getChat", {"chat_id": chat_id})
                member = call("getChatMember", {"chat_id": chat_id, "user_id": bot["id"]})
                if chat.get("id") != chat_id or chat.get("username") != channel or chat.get("type") != "channel" or member.get("status") != "administrator" or not member.get("can_delete_messages"):
                    raise RuntimeError("Authorized channel deletion rights are unavailable")
                allowed.add(channel)
            # Both title and the known status sentence were matched in the
            # current public post, with the exact channel identity and age.
            result = call("deleteMessage", {"chat_id": chat_id, "message_id": row["message_id"]})
            if result is not True:
                raise RuntimeError("Telegram deletion was not confirmed")
            receipt = {"status": "deleted", "post": row["post"], "chatId": chat_id, "messageId": row["message_id"], "textSha256": hashlib.sha256(row["text"].encode()).hexdigest(), "confirmedAt": datetime.now(timezone.utc).isoformat()}
            state["deleted"][row["post"]] = receipt
            state["deleted"] = dict(list(state["deleted"].items())[-1000:])
            atomic(state_file, state)
            atomic(ROOT / (str(time.time_ns()) + "-receipt.json"), receipt)
            print(json.dumps(receipt))
        atomic(ROOT / "latest.json", {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "healthy", "deleted": [row["post"] for _, row in candidates[:6]]})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # URLs in transport exceptions can contain bot credentials. Report only
        # the exception class; retain no request URLs or response bodies.
        print(json.dumps({"status": "failed", "errorType": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
