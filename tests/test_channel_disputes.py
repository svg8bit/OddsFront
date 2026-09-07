import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("channel_disputes", Path(__file__).resolve().parents[1] / "scripts/news/channel_disputes.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW = datetime(2026, 9, 7, 22, 0, tzinfo=timezone.utc)


def card(post, text, date="2026-09-07T21:57:00+00:00"):
    return f'<div class="tgme_widget_message js-widget_message" data-post="{post}"><div class="tgme_widget_message_text js-message_text">{text}</div><a class="tgme_widget_message_date" href="https://t.me/{post}"><time datetime="{date}">21:57</time></a></div>'


class DisputesTest(unittest.TestCase):
    def test_exact_dispute_only(self):
        dispute = '<b>⚠️ Polymarket Resolution Disputed</b><br><br>🟦 Market question?<br>' + module.DISPUTED_STATUS
        html = card("oddsfront/14", dispute) + card("oddsfront/15", "🗞 Reporting mentions Polymarket Resolution Disputed " + module.DISPUTED_STATUS) + card("oddsfront/13", "⚠️ Polymarket Clarification " + module.DISPUTED_STATUS)
        selected = module.disputed_alerts(module.public_messages(html), "oddsfront", NOW)
        self.assertEqual([row["message_id"] for row in selected], [14])

    def test_identity_time_and_complete_markup(self):
        text = "⚠️ Polymarket Resolution Disputed<br>" + module.DISPUTED_STATUS
        html = card("another_channel/14", text) + card("oddsfront/15", text, "2026-09-01T21:57:00Z") + card("oddsfront/16", text, "2026-09-08T21:57:00Z") + card("oddsfront/17", text, "2026-09-07T21:57:00") + card("oddsfront/18", text)[:-6]
        self.assertEqual(module.disputed_alerts(module.public_messages(html), "oddsfront", NOW), [])

    def test_missing_status_or_foreign_date_link(self):
        html = card("oddsfront_ru/8", "⚠️ Polymarket Resolution Disputed")
        valid = card("oddsfront_ru/9", "⚠️ Polymarket Resolution Disputed<br>" + module.DISPUTED_STATUS)
        html += valid.replace('href="https://t.me/oddsfront_ru/9"', 'href="https://t.me/another_channel/9"')
        self.assertEqual(module.disputed_alerts(module.public_messages(html), "oddsfront_ru", NOW), [])
        with self.assertRaises(ValueError):
            module.disputed_alerts([], "another_channel", NOW)


if __name__ == "__main__":
    unittest.main()
