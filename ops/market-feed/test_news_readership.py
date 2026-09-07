"""Development-only readership fixtures; never use the production database."""

import concurrent.futures
import hashlib
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

import oddsfront_market_feed as feed
from news_readership import Readership, WINDOW_SECONDS

NOW = 1_788_790_000


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class ReadershipTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "development-views.sqlite3"
        self.store = Readership(self.database)

    def tearDown(self):
        self.temporary.cleanup()

    def test_reload_deduplication_and_distinct_readers(self):
        self.assertTrue(self.store.record("development-story", digest("reader-1"), digest("network"), NOW))
        self.assertFalse(self.store.record("development-story", digest("reader-1"), digest("network"), NOW + 30))
        self.assertTrue(self.store.record("development-story", digest("reader-2"), digest("network"), NOW + 60))
        self.assertEqual(self.store.counts(NOW + 60), {"development-story": 2})
        self.assertEqual(self.database.stat().st_mode & 0o777, 0o600)

    def test_exact_seven_day_window_excludes_old_and_future_reads(self):
        self.store.record("development-future", digest("reader"), digest("network"), NOW + WINDOW_SECONDS + 1)
        self.store.record("development-old", digest("reader"), digest("network"), NOW)
        self.store.record("development-new", digest("reader"), digest("network"), NOW + 1)
        self.assertEqual(self.store.counts(NOW + WINDOW_SECONDS), {"development-new": 1})

    def test_reading_again_on_a_later_day_counts_once(self):
        self.store.record("development-story", digest("reader"), digest("network"), NOW)
        self.assertTrue(self.store.record("development-story", digest("reader"), digest("network"), NOW + 86400))
        self.assertEqual(self.store.counts(NOW + 86400), {"development-story": 2})

    def test_persistence_survives_service_restart(self):
        self.store.record("development-story", digest("reader"), digest("network"), NOW)
        self.assertEqual(Readership(self.database).counts(NOW), {"development-story": 1})

    def test_concurrent_requests_do_not_double_count(self):
        self.store.counts(NOW)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.store.record("development-story", digest("reader"), digest("network"), NOW), range(16)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.store.counts(NOW), {"development-story": 1})

    def test_rate_limit_is_per_network_and_recovers(self):
        stamp = NOW // 60 * 60
        for index in range(30):
            self.store.record("development-story", digest(f"reader-{index}"), digest("network"), stamp)
        with self.assertRaises(OverflowError):
            self.store.record("development-story", digest("next-reader"), digest("network"), stamp)
        self.assertTrue(self.store.record("development-story", digest("next-reader"), digest("another-network"), stamp))
        self.assertTrue(self.store.record("development-story", digest("last-reader"), digest("network"), stamp + 60))

    def test_raw_identifiers_and_invalid_slugs_are_rejected(self):
        for slug, reader, network in [("../outside", digest("reader"), digest("network")), ("development-story", "raw-session", digest("network")), ("development-story", digest("reader"), "192.0.2.1")]:
            with self.assertRaises(ValueError):
                self.store.record(slug, reader, network, NOW)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "articles").mkdir()
        (self.root / "articles/development-story.json").write_text('{"slug":"development-story"}')
        (self.root / "catalog.json").write_text('{"version":1,"articles":[{"slug":"development-story"}]}')
        self.old_root, self.old_store = feed.NEWS_ROOT, feed.READERSHIP
        feed.NEWS_ROOT = self.root
        feed.READERSHIP = Readership(self.root / "development-views.sqlite3")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), feed.Handler)
        self.server.feed_token = "development-only-test-token"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        feed.NEWS_ROOT, feed.READERSHIP = self.old_root, self.old_store
        self.temporary.cleanup()

    def request(self, method, path, body=None, authorized=True):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {"Content-Type": "application/json"}
        if authorized:
            headers["Authorization"] = "Bearer development-only-test-token"
        connection.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = connection.getresponse()
        status, data = response.status, json.loads(response.read())
        connection.close()
        return status, data

    def test_authentication_unknown_articles_and_published_readership(self):
        body = {"reader": digest("reader"), "network": digest("network")}
        self.assertEqual(self.request("POST", "/v1/news/articles/development-story/view", body, False)[0], 401)
        self.assertEqual(self.request("POST", "/v1/news/articles/unknown-story/view", body)[0], 404)
        self.assertEqual(self.request("POST", "/v1/news/articles/development-story/view", body), (200, {"counted": True}))
        self.assertEqual(self.request("POST", "/v1/news/articles/development-story/view", body), (200, {"counted": False}))
        status, catalog = self.request("GET", "/v1/news")
        self.assertEqual(status, 200)
        self.assertEqual(catalog["articles"][0]["views7d"], 1)

    def test_malformed_bodies_do_not_create_counts(self):
        for body in [[], {"reader": None}, {"reader": "x" * 1000}, {"reader": "raw", "network": "raw"}]:
            self.assertEqual(self.request("POST", "/v1/news/articles/development-story/view", body)[0], 400)
        self.assertEqual(feed.READERSHIP.counts(), {})


if __name__ == "__main__":
    unittest.main()
