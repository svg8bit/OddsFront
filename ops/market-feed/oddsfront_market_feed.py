#!/usr/bin/env python3
"""Small authenticated VPS cache for the OddsFront market strip."""

from __future__ import annotations

import hmac
import json
import os
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


DROPSTAB_BASE = "https://dropstab.com"
NEXT_DATA_PATTERN = re.compile(
    r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.DOTALL
)
REFRESH_SECONDS = 15 * 60
REQUEST_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class AssetDefinition:
    id: str
    display_symbol: str
    name: str
    slug: str


ASSETS = (
    AssetDefinition("bitcoin", "BTC", "Bitcoin", "bitcoin"),
    AssetDefinition("gold", "Gold", "Gold", "gold-metal"),
    AssetDefinition("silver", "Silver", "Silver", "silver-metal"),
    AssetDefinition("copper", "Copper", "Copper", "copper-metal"),
    AssetDefinition("oil", "Oil", "Brent Crude Oil", "brent-crude-oil"),
    AssetDefinition("sp500", "S&P 500", "S&P 500", "sp500-index"),
    AssetDefinition(
        "nvidia", "NVDA", "NVIDIA Corporation", "nvidia-corporation"
    ),
    AssetDefinition("apple", "AAPL", "Apple Inc.", "apple-aapl"),
    AssetDefinition(
        "spacex", "SpaceX", "SpaceX Technologies Corp.", "spacex-technologies"
    ),
    AssetDefinition("ethereum", "ETH", "Ethereum", "ethereum"),
)
ASSET_BY_SLUG = {asset.slug: asset for asset in ASSETS}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and abs(result) != float("inf") else None


def _positive_number(value: Any) -> float | None:
    result = _number(value)
    return result if result is not None and result > 0 else None


def _usd(value: Any) -> float | None:
    if isinstance(value, dict):
        return _number(value.get("USD"))
    return _number(value)


def _positive_usd(value: Any) -> float | None:
    if isinstance(value, dict):
        return _positive_number(value.get("USD"))
    return _positive_number(value)


def _change_24h(value: Any) -> float | None:
    if not isinstance(value, dict):
        return None
    one_day = value.get("1D")
    return _usd(one_day)


def _collect_coins(value: Any, result: dict[str, dict[str, Any]]) -> None:
    if isinstance(value, list):
        for item in value:
            _collect_coins(item, result)
        return
    if not isinstance(value, dict):
        return

    slug = value.get("slug")
    if isinstance(slug, str) and slug in ASSET_BY_SLUG and slug not in result:
        price = _positive_usd(value.get("price"))
        change = _change_24h(value.get("change"))
        if price is not None and change is not None:
            result[slug] = {"price": price, "priceChange24h": change}
    for child in value.values():
        _collect_coins(child, result)


def _fetch_page(path: str) -> dict[str, dict[str, Any]]:
    request = urllib.request.Request(
        f"{DROPSTAB_BASE}{path}",
        headers={"Accept": "text/html", "User-Agent": "OddsFront-VPS/1.0"},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        html = response.read().decode("utf-8", "replace")
    match = NEXT_DATA_PATTERN.search(html)
    if not match:
        return {}
    payload = json.loads(match.group(1))
    result: dict[str, dict[str, Any]] = {}
    _collect_coins(payload, result)
    return result


def _dropsbot_url(slug: str) -> str:
    return f"https://t.me/Drops?start=dropstab_{slug}"


def _dropstab_url(slug: str) -> str:
    return f"https://dropstab.com/coins/{slug}"


def _build_feed(values: dict[str, dict[str, Any]]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    assets = []
    for definition in ASSETS:
        current = values.get(definition.slug, {})
        price = _positive_number(current.get("price"))
        price_change_24h = _number(current.get("priceChange24h"))
        assets.append(
            {
                "id": definition.id,
                "displaySymbol": definition.display_symbol,
                "name": definition.name,
                "sourceSymbol": definition.display_symbol,
                "slug": definition.slug,
                "price": price,
                "priceChange24h": price_change_24h,
                "dropsBotUrl": _dropsbot_url(definition.slug),
                "dropstabUrl": _dropstab_url(definition.slug),
            }
        )
    live_count = sum(
        asset["price"] is not None and asset["priceChange24h"] is not None
        for asset in assets
    )
    mode = "live" if live_count == len(assets) else "partial" if live_count else "unavailable"
    return {
        "dataMode": mode,
        "updatedAt": now,
        "refreshSeconds": REFRESH_SECONDS,
        "sourceLabel": "OddsFront VPS cache · DropsTab",
        "assets": assets,
    }


def _merge_last_good(
    previous_feed: dict[str, Any], fresh_values: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    previous_assets = previous_feed.get("assets")
    if isinstance(previous_assets, list):
        for asset in previous_assets:
            if not isinstance(asset, dict):
                continue
            slug = asset.get("slug")
            price = _positive_number(asset.get("price"))
            change = _number(asset.get("priceChange24h"))
            if slug in ASSET_BY_SLUG and price is not None and change is not None:
                merged[slug] = {"price": price, "priceChange24h": change}
    for slug, values in fresh_values.items():
        price = _positive_number(values.get("price"))
        change = _number(values.get("priceChange24h"))
        if slug in ASSET_BY_SLUG and price is not None and change is not None:
            merged[slug] = {"price": price, "priceChange24h": change}
    return merged


class FeedState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.feed = _build_feed({})

    def refresh(self) -> None:
        values: dict[str, dict[str, Any]] = {}
        try:
            values.update(_fetch_page("/tab/tradfi"))
        except Exception as error:  # noqa: BLE001 - preserve the last good cache
            print(f"tradfi refresh failed: {error}", flush=True)

        missing = [asset for asset in ASSETS if asset.slug not in values]
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {
                executor.submit(_fetch_page, f"/coins/{asset.slug}"): asset
                for asset in missing
            }
            for future in as_completed(futures):
                asset = futures[future]
                try:
                    coin = future.result().get(asset.slug)
                    if coin:
                        values[asset.slug] = coin
                except Exception as error:  # noqa: BLE001 - preserve the last good cache
                    print(f"asset refresh failed for {asset.slug}: {error}", flush=True)

        with self.lock:
            candidate = _build_feed(_merge_last_good(self.feed, values))
            if candidate["dataMode"] != "unavailable":
                self.feed = candidate
            current = self.feed
        live_count = sum(asset["price"] is not None for asset in current["assets"])
        print(
            f"market feed refreshed: mode={current['dataMode']} live={live_count}/{len(ASSETS)}",
            flush=True,
        )

    def body(self) -> bytes:
        with self.lock:
            return json.dumps(self.feed, separators=(",", ":")).encode("utf-8")

    def health(self) -> tuple[int, bytes]:
        with self.lock:
            feed = self.feed
        live_count = sum(asset["price"] is not None for asset in feed["assets"])
        status = 200 if live_count == len(ASSETS) else 503
        body = json.dumps(
            {
                "status": "ok" if status == 200 else "degraded",
                "dataMode": feed["dataMode"],
                "liveAssets": live_count,
                "updatedAt": feed["updatedAt"],
            },
            separators=(",", ":"),
        ).encode("utf-8")
        return status, body


STATE = FeedState()


class Handler(BaseHTTPRequestHandler):
    server_version = "OddsFrontFeed/1.0"

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.feed_token}"  # type: ignore[attr-defined]
        return hmac.compare_digest(supplied, expected)

    def _send_json(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        if not self._authorized():
            self._send_json(401, b'{"error":"unauthorized"}')
            return
        if self.path == "/v1/news" or self.path.startswith("/v1/news/articles/"):
            from pathlib import Path
            import re
            news_root = Path("/opt/oddsfront-market-feed/news")
            if self.path == "/v1/news":
                target = news_root / "catalog.json"
            else:
                slug = self.path.removeprefix("/v1/news/articles/")
                if len(slug) > 100 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
                    self._send_json(400, b'{"error":"invalid_slug"}')
                    return
                target = news_root / "articles" / f"{slug}.json"
            try:
                self._send_json(200, target.read_bytes())
            except FileNotFoundError:
                self._send_json(404, b'{"error":"not_found"}')
            except OSError:
                self._send_json(503, b'{"error":"news_unavailable"}')
            return
        if self.path == "/v1/market-strip":
            self._send_json(200, STATE.body())
            return
        if self.path == "/healthz":
            status, body = STATE.health()
            self._send_json(status, body)
            return
        self._send_json(404, b'{"error":"not_found"}')

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)


def _refresh_loop() -> None:
    while True:
        time.sleep(REFRESH_SECONDS)
        STATE.refresh()


def main() -> None:
    token = os.environ.get("ODDSFRONT_FEED_TOKEN", "").strip()
    if len(token) < 32:
        raise SystemExit("ODDSFRONT_FEED_TOKEN must contain at least 32 characters")
    host = os.environ.get("ODDSFRONT_FEED_HOST", "127.0.0.1")
    port = int(os.environ.get("ODDSFRONT_FEED_PORT", "8091"))
    STATE.refresh()
    threading.Thread(target=_refresh_loop, name="market-refresh", daemon=True).start()
    server = ThreadingHTTPServer((host, port), Handler)
    server.feed_token = token  # type: ignore[attr-defined]
    print(f"OddsFront market feed listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
