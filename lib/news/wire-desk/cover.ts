// The article cover: OddsFront's own live conflict map, framed on the story's
// country (and on the cited market's marker when that very market is on the
// map), without publisher photos and without text. The site and the social
// card draw the localized headline over it, so one picture serves EN and RU.
import sharp from "sharp";
import type { Browser } from "@playwright/test";
import { captureMapShot, chooseMapFocus, fetchMapFeed, loadCountryAnchors, MAP_SCALE, type CountryAnchor, type MapFeedEvent, type MapFocus } from "../hot-desk/map-card.ts";

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 840;

export type CoverContext = { events: MapFeedEvent[]; anchors: CountryAnchor[] };

export async function coverContext(root = process.cwd()): Promise<CoverContext> {
  const [events, anchors] = await Promise.all([fetchMapFeed(), loadCountryAnchors(root)]);
  return { events, anchors };
}

/**
 * Where the cover looks: the cited market's own marker, else the busiest
 * marker located in the story's main country, else that country, else any
 * marker involving the story's countries. No popup is ever opened: a static
 * cover would freeze its odds, and mobile crops cut the popup in half.
 */
export function coverFocus(context: CoverContext, countries: readonly string[], market: { conditionId: string | null; eventId: string | null } | null): MapFocus | null {
  const none = { conditionId: null, eventId: null };
  if (market && (market.conditionId || market.eventId)) {
    const own = chooseMapFocus(context.events, market, [], []);
    if (own?.kind === "market") return { ...own, kind: "event" };
  }
  const main = countries[0];
  if (main) {
    const local = chooseMapFocus(context.events.filter(event => event.countryCodes[0] === main), none, [main], context.anchors);
    if (local) return local;
  }
  const fallback = chooseMapFocus(context.events, none, countries.slice(0, 3), context.anchors);
  return fallback;
}

// captureMapShot puts the framed marker at 60% / 64% of the map canvas.
const MARKER = { x: 0.6, y: 0.64 } as const;

/** A soft brand glow and two rings around the story's location, plus a light vignette. */
export function focusOverlaySvg(x: number, y: number, width = COVER_WIDTH, height = COVER_HEIGHT, dot = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="${x}" cy="${y}" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7778FF" stop-opacity="0.42"/><stop offset="0.45" stop-color="#6366F1" stop-opacity="0.15"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignette" cx="${width / 2}" cy="${height / 2}" r="${Math.hypot(width, height) / 2}" gradientUnits="userSpaceOnUse"><stop offset="0.55" stop-color="#030914" stop-opacity="0"/><stop offset="1" stop-color="#030914" stop-opacity="0.55"/></radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#vignette)"/>
  <circle cx="${x}" cy="${y}" r="300" fill="url(#glow)"/>
  <circle cx="${x}" cy="${y}" r="92" fill="none" stroke="#B4B5FF" stroke-opacity="0.3" stroke-width="2"/>
  <circle cx="${x}" cy="${y}" r="48" fill="none" stroke="#B4B5FF" stroke-opacity="0.65" stroke-width="2.5"/>${dot ? `
  <circle cx="${x}" cy="${y}" r="7" fill="#E0E1FF"/>` : ""}
</svg>`;
}

/** JPEG cover from a map shot: the ticker strip above the map is cut off and the story's location is highlighted. */
export async function coverJpeg(png: Buffer, stripHeight: number, dot = false): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const top = Math.min(Math.round(stripHeight * MAP_SCALE), Math.floor(height / 3));
  const cropped = height - top;
  const scale = Math.max(COVER_WIDTH / width, COVER_HEIGHT / cropped);
  const x = MARKER.x * width * scale - (width * scale - COVER_WIDTH) / 2;
  const y = (MARKER.y * height - top) * scale - (cropped * scale - COVER_HEIGHT) / 2;
  return sharp(png)
    .extract({ left: 0, top, width, height: cropped })
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "centre" })
    // The night map is darker than the photos the site's card shade was made for.
    .modulate({ brightness: 1.3, saturation: 1.15 })
    .composite([{ input: Buffer.from(focusOverlaySvg(Math.round(x), Math.round(y), COVER_WIDTH, COVER_HEIGHT, dot)), top: 0, left: 0 }])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}

export type RenderedCover = { jpeg: Buffer; focus: MapFocus; popupOpen: boolean };

/** One cover, or null when the map cannot frame or capture the story (the article then shows the site's own artwork). */
export async function renderCover(browser: Browser, focus: MapFocus | null, siteUrl?: string): Promise<{ cover: RenderedCover | null; reason: string | null }> {
  if (!focus) return { cover: null, reason: "no country or marker to frame" };
  try {
    const shot = await captureMapShot(browser, focus, siteUrl);
    // A country frame has no marker of its own: mark the spot.
    return { cover: { jpeg: await coverJpeg(shot.png, shot.stripHeight, focus.kind === "country"), focus, popupOpen: shot.popupOpen }, reason: null };
  } catch (error) {
    return { cover: null, reason: error instanceof Error ? error.message.slice(0, 200) : "map capture failed" };
  }
}

export async function launchCoverBrowser(): Promise<Browser> {
  const { chromium } = await import("@playwright/test");
  return chromium.launch({ args: ["--font-render-hinting=none", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}
