"""Identify only the known Drops disputed-resolution alert in our public channels."""
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import re

CHANNELS = {"oddsfront": -1004406802006, "oddsfront_ru": -1004118165561}
DISPUTED_STATUS = "Status: Proposed resolution was disputed. Final resolution may take longer."


class ChannelMessages(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.row = None
        self.row_depth = None
        self.text_depth = None
        self.date_link = False
        self.messages = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if tag == "div":
            self.depth += 1
            if self.row is None and "tgme_widget_message" in classes:
                self.row = {"post": attrs.get("data-post", ""), "text": "", "date": ""}
                self.row_depth = self.depth
            if self.row is not None and "tgme_widget_message_text" in classes:
                self.text_depth = self.depth
        if self.row is None:
            return
        if tag == "br" and self.text_depth is not None:
            self.row["text"] += "\n"
        if tag == "a":
            self.date_link = "tgme_widget_message_date" in classes and attrs.get("href") == "https://t.me/" + self.row["post"]
        if tag == "time" and self.date_link:
            self.row["date"] = attrs.get("datetime", "")

    def handle_endtag(self, tag):
        if tag == "a":
            self.date_link = False
        if tag == "div":
            if self.depth == self.text_depth:
                self.text_depth = None
            if self.row is not None and self.depth == self.row_depth:
                self.messages.append(self.row)
                self.row = None
                self.row_depth = None
                self.text_depth = None
            self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.row is not None and self.text_depth is not None:
            self.row["text"] += data


def public_messages(html):
    parser = ChannelMessages()
    parser.feed(html)
    parser.close()
    return parser.messages


def disputed_alerts(messages, channel, now=None):
    if channel not in CHANNELS:
        raise ValueError("Only the two authorized OddsFront channels are supported")
    now = now or datetime.now(timezone.utc)
    selected = []
    for row in messages:
        identity = re.fullmatch(re.escape(channel) + r"/([1-9][0-9]{0,10})", row["post"])
        text = " ".join(row["text"].replace("\ufe0f", "").split())
        if not identity or not re.match(r"^⚠\s+Polymarket Resolution Disputed(?:\s|🟦)", text) or DISPUTED_STATUS not in text:
            continue
        try:
            observed = datetime.fromisoformat(row["date"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if observed.tzinfo is None or observed > now + timedelta(minutes=1) or now - observed >= timedelta(hours=47):
            continue
        selected.append({**row, "message_id": int(identity[1])})
    return selected
