"""Private, bounded, anonymous readership counts for the OddsFront news rail."""

from __future__ import annotations

import os
import re
import sqlite3
import time
from pathlib import Path

WINDOW_SECONDS = 7 * 24 * 60 * 60
DIGEST = re.compile(r"[a-f0-9]{64}")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class Readership:
    def __init__(self, database: Path):
        self.database = database

    def _connect(self) -> sqlite3.Connection:
        self.database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        db = sqlite3.connect(self.database, timeout=5)
        os.chmod(self.database, 0o600)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS reads (
            slug TEXT NOT NULL, reader TEXT NOT NULL, day INTEGER NOT NULL,
            occurred_at INTEGER NOT NULL, PRIMARY KEY (slug, reader, day))""")
        db.execute("CREATE INDEX IF NOT EXISTS reads_time ON reads (occurred_at)")
        db.execute("""CREATE TABLE IF NOT EXISTS rate_limits (
            network TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL,
            PRIMARY KEY (network, minute))""")
        return db

    def record(self, slug: str, reader: str, network: str, now: int | None = None) -> bool:
        if len(slug) > 100 or not SLUG.fullmatch(slug) or not DIGEST.fullmatch(reader) or not DIGEST.fullmatch(network):
            raise ValueError("Invalid readership request")
        stamp = int(time.time()) if now is None else now
        db = self._connect()
        try:
            with db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("DELETE FROM reads WHERE occurred_at <= ?", (stamp - WINDOW_SECONDS,))
                db.execute("DELETE FROM rate_limits WHERE minute < ?", (stamp // 60 - 1,))
                previous = db.execute("SELECT 1 FROM reads WHERE slug=? AND reader=? AND day=?", (slug, reader, stamp // 86400)).fetchone()
                if previous:
                    return False
                count = db.execute("SELECT count FROM rate_limits WHERE network=? AND minute=?", (network, stamp // 60)).fetchone()
                if count and count[0] >= 30:
                    raise OverflowError("Readership rate limit")
                db.execute("INSERT INTO rate_limits VALUES (?, ?, 1) ON CONFLICT(network, minute) DO UPDATE SET count=count+1", (network, stamp // 60))
                db.execute("INSERT INTO reads VALUES (?, ?, ?, ?)", (slug, reader, stamp // 86400, stamp))
            return True
        finally:
            db.close()

    def counts(self, now: int | None = None) -> dict[str, int]:
        stamp = int(time.time()) if now is None else now
        db = self._connect()
        try:
            with db:
                db.execute("DELETE FROM reads WHERE occurred_at <= ?", (stamp - WINDOW_SECONDS,))
                db.execute("DELETE FROM rate_limits WHERE minute < ?", (stamp // 60 - 1,))
                rows = db.execute("SELECT slug, COUNT(*) FROM reads WHERE occurred_at > ? AND occurred_at <= ? GROUP BY slug", (stamp - WINDOW_SECONDS, stamp)).fetchall()
            return dict(rows)
        finally:
            db.close()
