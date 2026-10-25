// The post picture: a live screenshot of the OddsFront conflict map, zoomed to
// the story with the chosen market's popup open, under a dark left gradient
// carrying the logo, the headline and the odds line.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import type { ConflictPreviewEvent } from "../../../features/global-conflict-map/preview/types.ts";
import { escapeHtml, type HotDeskLocale } from "./post.ts";

export const MAP_SITE_URL = "https://oddsfront.com/";
export const MAP_FEED_URL = "https://oddsfront.com/api/global-conflict-events";
/** CSS viewport of the shot; the PNG is 1.25× (1600×855, the reference's 1.87:1). */
export const MAP_VIEWPORT = { width: 1280, height: 684 } as const;
export const MAP_SCALE = 1.25;

export type MapFeedEvent = Pick<ConflictPreviewEvent, "id" | "title" | "coordinates" | "countryCodes" | "locationId" | "marketConditionId" | "volume" | "marketVolume" | "geographyKind">;
export type MapFocus = {
  kind: "market" | "event" | "country-marker" | "country";
  /** The map event whose popup opens, or null to frame a country without a popup. */
  eventId: string | null;
  /** Events sharing the marker, best first: the marker button belongs to one of them. */
  groupIds: string[];
  coordinates: [number, number];
  zoomSteps: number;
};

export async function fetchMapFeed(url = MAP_FEED_URL): Promise<MapFeedEvent[]> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); return []; }
    const feed = await response.json() as { dataMode?: string; events?: MapFeedEvent[] };
    return feed.dataMode === "live" && Array.isArray(feed.events) ? feed.events : [];
  } catch { return []; }
}

export type CountryAnchor = { iso2: string; coordinates: [number, number] };

export async function loadCountryAnchors(root = process.cwd()): Promise<CountryAnchor[]> {
  try {
    const rows = JSON.parse(await readFile(path.join(root, "features/global-conflict-map/preview/country-anchors.generated.json"), "utf8")) as CountryAnchor[];
    return rows.filter(row => /^[A-Z]{2}$/.test(row.iso2) && Array.isArray(row.coordinates));
  } catch { return []; }
}

// Countries that fill the frame at zoom 4.7; frame them one step wider.
const LARGE_COUNTRIES = new Set(["US", "RU", "CN", "CA", "BR", "AU", "IN", "KZ", "AR"]);
const volume = (event: MapFeedEvent) => event.marketVolume ?? event.volume;

/**
 * Where the picture looks: the chosen market's own marker, else its event's
 * marker, else the busiest marker in the story's countries, else the story's
 * country without a popup. Null when nothing on the map relates.
 */
export function chooseMapFocus(events: readonly MapFeedEvent[], market: { conditionId: string | null; eventId: string | null }, countryCodes: readonly string[], anchors: readonly CountryAnchor[] = []): MapFocus | null {
  const steps = (codes: readonly string[], kind: string | undefined) => (kind === "alliance" || codes.some(code => LARGE_COUNTRIES.has(code)) ? 2 : 3);
  const focusOn = (event: MapFeedEvent, kind: MapFocus["kind"]): MapFocus => ({
    kind,
    eventId: event.id,
    groupIds: events.filter(other => other.locationId === event.locationId).toSorted((a, b) => b.volume - a.volume).map(other => other.id),
    coordinates: event.coordinates,
    // The marker's own country sets the frame (participants such as the US do not).
    zoomSteps: steps(event.countryCodes.slice(0, 1), event.geographyKind),
  });
  const exact = market.conditionId ? events.find(event => event.marketConditionId?.toLowerCase() === market.conditionId) : undefined;
  if (exact) return focusOn(exact, "market");
  const sameEvent = market.eventId ? events.find(event => event.id === `polymarket-${market.eventId}`) : undefined;
  if (sameEvent) return focusOn(sameEvent, "event");
  for (const code of countryCodes) {
    const local = events.filter(event => event.countryCodes.includes(code)).toSorted((a, b) => volume(b) - volume(a))[0];
    if (local) return focusOn(local, "country-marker");
  }
  const anchor = countryCodes.map(code => anchors.find(item => item.iso2 === code)).find(Boolean);
  return anchor ? { kind: "country", eventId: null, groupIds: [], coordinates: anchor.coordinates, zoomSteps: steps(countryCodes, undefined) } : null;
}

type Point = { x: number; y: number };

/** Web Mercator screen point of a coordinate for MapLibre's 512-px world at `zoom`. */
export function projectToScreen(coordinates: [number, number], camera: { longitude: number; latitude: number; zoom: number }, canvas: { x: number; y: number; width: number; height: number }): Point {
  const world = 512 * 2 ** camera.zoom;
  const x = (longitude: number) => ((longitude + 180) / 360) * world;
  const y = (latitude: number) => ((180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360))) / 360) * world;
  return {
    x: canvas.x + canvas.width / 2 + x(coordinates[0]) - x(camera.longitude),
    y: canvas.y + canvas.height / 2 + y(coordinates[1]) - y(camera.latitude),
  };
}

/** The point to double-click so that `marker` lands on `target` after a ×2 zoom, kept inside `bounds`. */
export function zoomAnchor(marker: Point, target: Point, bounds: { left: number; top: number; right: number; bottom: number }): Point {
  return { x: Math.min(bounds.right, Math.max(bounds.left, 2 * marker.x - target.x)), y: Math.min(bounds.bottom, Math.max(bounds.top, 2 * marker.y - target.y)) };
}

// Site chrome that does not belong in the picture: the activity cards, zoom
// buttons, News/language buttons and hover labels.
// The site's own DropsBot button is not ours to show: the post carries its own Yes/No bet buttons.
const HIDE_CHROME = `[class*="activityRail"], [class*="__controls"], nav[class*="site-navigation"], [class*="zoomReadout"], [class*="hotspotLabel"], [class*="trackButton"] { display: none !important; }`;

async function camera(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("main[data-map-ready]")!;
    return { longitude: Number(main.dataset.mapLongitude), latitude: Number(main.dataset.mapLatitude), zoom: Number(main.dataset.mapZoom), moving: main.dataset.mapMoving === "true" };
  });
}

async function settle(page: Page, zoomAtLeast?: number) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const view = await camera(page);
    if (!view.moving && (zoomAtLeast === undefined || view.zoom >= zoomAtLeast)) break;
    if (Date.now() > deadline) throw new Error("Map camera did not settle");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(250);
}

/** A point over bare map (not a marker or popup) near `point`. */
async function bareMapPoint(page: Page, point: Point): Promise<Point> {
  for (const [dx, dy] of [[0, 0], [28, 0], [-28, 0], [0, 28], [0, -28], [42, 42], [-42, -42], [56, -20]]) {
    const candidate = { x: point.x + dx!, y: point.y + dy! };
    const bare = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("maplibregl-canvas") ?? false, candidate);
    if (bare) return candidate;
  }
  throw new Error("No free map point to interact with");
}

/** Screenshot of the live map framed on `focus` (PNG at MAP_SCALE), or an error. */
// The map is always shot in English: the site's machine-translated Russian market titles read badly
// ("Выход из гормона"), while the original Polymarket question is what the Mini App shows too.
export async function captureMapShot(browser: Browser, focus: MapFocus, siteUrl = MAP_SITE_URL): Promise<{ png: Buffer; stripHeight: number; popupOpen: boolean }> {
  const context = await browser.newContext({ viewport: MAP_VIEWPORT, deviceScaleFactor: MAP_SCALE, locale: "en-US", colorScheme: "dark" });
  try {
    const page = await context.newPage();
    await page.goto(`${siteUrl}?lang=en`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector('main[data-map-ready="true"][data-tile-health="ready"]', { timeout: 60_000 });
    await page.addStyleTag({ content: HIDE_CHROME });
    await settle(page);
    const canvas = (await page.locator(".maplibregl-canvas").boundingBox())!;
    const stripHeight = await page.evaluate(() => document.querySelector('nav[class*="strip"]')?.getBoundingClientRect().bottom ?? 0);
    // The marker sits right of centre so the popup opens over open map,
    // clear of the headline gradient on the left.
    const target = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.64 };
    const bounds = { left: canvas.x + 24, top: Math.max(canvas.y, stripHeight) + 24, right: canvas.x + canvas.width - 24, bottom: canvas.y + canvas.height - 24 };
    for (let step = 0; step < focus.zoomSteps; step += 1) {
      const view = await camera(page);
      const anchor = await bareMapPoint(page, zoomAnchor(projectToScreen(focus.coordinates, view, canvas), target, bounds));
      await page.mouse.dblclick(anchor.x, anchor.y);
      await settle(page, view.zoom + 0.9);
    }
    // A final drag puts the marker exactly on target when the bounds held a zoom anchor back.
    const marker = projectToScreen(focus.coordinates, await camera(page), canvas);
    if (Math.hypot(marker.x - target.x, marker.y - target.y) > 20) {
      const start = await bareMapPoint(page, { x: canvas.x + canvas.width * 0.35, y: canvas.y + canvas.height * 0.5 });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + target.x - marker.x, start.y + target.y - marker.y, { steps: 16 });
      await page.waitForTimeout(400);
      await page.mouse.up();
      await settle(page);
    }
    let popupOpen = false;
    // Only the post's own market gets an open popup: another market of the same event would show
    // numbers that contradict the card's subtitle.
    if (focus.eventId && focus.kind === "market") {
      const markerId = await page.evaluate(ids => ids.find(id => document.querySelector(`[data-market-event-id="${CSS.escape(id)}"]`)) ?? null, focus.groupIds);
      if (markerId) {
        await page.locator(`[data-market-event-id="${markerId}"]`).click({ force: true });
        await page.waitForSelector('[data-testid="conflict-popup"]', { timeout: 5_000 });
        // Step through the markers' shared popup to the chosen market.
        for (let tries = 0; tries < focus.groupIds.length && !(await page.locator(`[id="preview-market-${focus.eventId}"]`).count()); tries += 1) {
          await page.locator('[class*="marketPager"] button').last().click();
          await page.waitForTimeout(150);
        }
        popupOpen = (await page.locator(`[id="preview-market-${focus.eventId}"]`).count()) > 0;
        if (!popupOpen) await page.locator('[data-testid="conflict-popup"] button[class*="popupClose"]').click();
        await page.mouse.move(canvas.x + canvas.width - 4, canvas.y + canvas.height - 4);
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("img[data-market-image]")].every(image => image.complete), undefined, { timeout: 5_000 }).catch(() => undefined);
      }
    }
    await page.waitForTimeout(700);
    return { png: await page.screenshot({ type: "png" }), stripHeight, popupOpen };
  } finally {
    await context.close();
  }
}

export type MapCardInput = { locale: HotDeskLocale; /** The short card headline, not the caption title. */ title: string; subtitle: string; direction: "up" | "down" | null; map: { png: Buffer; stripHeight: number } };

export function mapCardHtml({ locale, title, subtitle, direction, map }: MapCardInput, fonts: { bold: string; variable: string }) {
  // Colour only the move ("▼ 1,3% за сутки"), keep the odds in white.
  const [odds, ...moves] = subtitle.split(" · ");
  const strip = Math.round(map.stripHeight);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter Card"; src: url(data:font/woff2;base64,${fonts.variable}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Inter Card Bold"; src: url(data:font/ttf;base64,${fonts.bold}) format("truetype"); font-weight: 700; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${MAP_VIEWPORT.width}px; height: ${MAP_VIEWPORT.height}px; overflow: hidden; background: #050b18; }
body { font-family: "Inter Card", sans-serif; color: #f8fafc; position: relative; }
.map { position: absolute; inset: 0; background: url(data:image/png;base64,${map.png.toString("base64")}) center / cover no-repeat; }
.shade { position: absolute; left: 0; right: 0; top: ${strip}px; bottom: 0;
  background: linear-gradient(90deg, rgba(4,9,20,0.97) 0%, rgba(4,9,20,0.93) 27%, rgba(4,9,20,0.74) 41%, rgba(4,9,20,0.32) 52%, rgba(4,9,20,0) 62%),
    linear-gradient(0deg, rgba(4,9,20,0.55) 0%, rgba(4,9,20,0) 22%); }
.copy { position: absolute; left: 56px; top: ${strip}px; bottom: 0; width: 600px; display: flex; flex-direction: column; padding: 40px 0 46px; }
.brand { display: flex; align-items: center; gap: 13px; font-family: "Inter Card Bold"; font-size: 27px; letter-spacing: -0.01em; }
.brand svg { width: 44px; height: 33px; }
.body { margin: auto 0; }
.headline { font-family: "Inter Card Bold"; font-size: 64px; line-height: 1.07; letter-spacing: -0.028em; max-height: 360px; overflow: hidden; text-wrap: balance; text-shadow: 0 2px 24px rgba(0,0,0,0.35); }
.subtitle { margin-top: 26px; font-size: 26px; font-weight: 500; color: #d3dbe8; letter-spacing: -0.005em; }
.subtitle b { font-weight: 650; color: #f8fafc; }
.subtitle .up { color: #4ade80; font-weight: 600; }
.subtitle .down { color: #f87171; font-weight: 600; }
.site { font-size: 19px; color: #8fa1bb; letter-spacing: 0.02em; }
</style></head><body><div class="map"></div><div class="shade"></div>
<div class="copy">
  <div class="brand"><svg viewBox="0 0 300 224"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7778FF"/><stop offset="1" stop-color="#5548FF"/></linearGradient></defs><path d="M106 0H178L72 224H0Z M228 0H300L194 224H122Z" fill="url(#m)"/></svg>OddsFront</div>
  <div class="body">
    <h1 class="headline" id="headline">${escapeHtml(title)}</h1>
    <p class="subtitle"><b>${escapeHtml(odds ?? "")}</b>${moves.length ? ` · <span class="${direction ?? ""}">${escapeHtml(moves.join(" · "))}</span>` : ""}</p>
  </div>
  <div class="site">oddsfront.com</div>
</div></body></html>`;
}
