import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";

import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import {
  normalizeConflictPreviewEvent,
  type GammaEvent,
} from "../lib/polymarket-conflict-preview";
import { buildDropsBotTrackUrl } from "../lib/polymarket-links";
import {
  buildDropsBotAssetTrackUrl,
  buildDropstabAssetUrl,
} from "../lib/dropstab-links";
import {
  selectMapRenderProfile,
} from "../features/global-conflict-map/preview/map-render-profile";
import { createPreviewMapStyle } from "../features/global-conflict-map/preview/map-style";

const artifactRoot = path.resolve(
  process.cwd(),
  "output/visuals",
);

function mockConditionId(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

async function openReadyMap(
  page: Page,
  route = "/global-conflict-map-preview?fixture=1",
) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(route, {
    waitUntil: "domcontentloaded",
  });
  const shell = page.locator("main[data-map-ready]");
  await expect(shell).toHaveAttribute("data-map-ready", "true", { timeout: 30_000 });
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(250);
  return shell;
}

async function openActivityRailPage(page: Page) {
  // Activity-card behavior does not depend on the external vector-tile CDN.
  // An empty valid response keeps these regressions deterministic on CI.
  await page.route("https://tiles.openfreemap.org/planet/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/global-conflict-map-preview", {
    waitUntil: "domcontentloaded",
  });
  const shell = page.locator("main[data-map-ready]");
  await expect(shell).toHaveAttribute("data-feed-mode", "live", {
    timeout: 30_000,
  });
  await page.evaluate(async () => document.fonts.ready);
  return shell;
}

test("keeps the full map on a wide desktop with constrained hardware", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_917, height: 779 });
  await page.addInitScript(() => {
    Object.defineProperties(navigator, {
      deviceMemory: { configurable: true, value: 4 },
      hardwareConcurrency: { configurable: true, value: 4 },
    });
  });

  await openReadyMap(page);
  const stage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveCount(1);
  await expect(page.getByText("Detailed map", { exact: true })).toHaveCount(0);
  await expect(stage).toHaveCSS("width", "1917px");
  await expect(canvas).toHaveCSS("width", "1917px");
  await expect(page.locator("main[data-map-ready]")).toHaveAttribute(
    "data-map-pixel-ratio",
    "0.6",
  );
  await expect(page.locator("main[data-map-ready]")).toHaveAttribute(
    "data-map-raster-texture",
    "disabled",
  );
  const canvasResolution = await canvas.evaluate(
    (element: HTMLCanvasElement) => ({
      cssWidth: element.clientWidth,
      backingWidth: element.width,
    }),
  );
  expect(canvasResolution.backingWidth / canvasResolution.cssWidth).toBeCloseTo(
    0.6,
    2,
  );
});

test("selects a bounded WebGL canvas resolution without shrinking the map", () => {
  expect(
    selectMapRenderProfile({
      devicePixelRatio: 2,
      viewportWidth: 1_917,
      viewportHeight: 779,
      compactOrTouch: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }),
  ).toEqual({
    pixelRatio: 0.78,
    quality: "balanced",
    pixelBudget: 900_000,
  });
  expect(
    selectMapRenderProfile({
      devicePixelRatio: 1,
      viewportWidth: 1_917,
      viewportHeight: 779,
      compactOrTouch: false,
      hardwareConcurrency: 4,
      deviceMemory: 4,
    }),
  ).toEqual({
    pixelRatio: 0.6,
    quality: "constrained",
    pixelBudget: 520_000,
  });
  expect(
    selectMapRenderProfile({
      devicePixelRatio: 1,
      viewportWidth: 1_366,
      viewportHeight: 768,
      compactOrTouch: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }).pixelRatio,
  ).toBe(0.93);
  expect(
    selectMapRenderProfile({
      devicePixelRatio: 3,
      viewportWidth: 390,
      viewportHeight: 844,
      compactOrTouch: true,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }).pixelRatio,
  ).toBe(1);
});

test("drops expensive texture and glow passes only on constrained hardware", () => {
  const balanced = createPreviewMapStyle("balanced");
  const constrained = createPreviewMapStyle("constrained");
  const balancedLayerIds = new Set(balanced.layers.map((layer) => layer.id));
  const constrainedLayerIds = new Set(
    constrained.layers.map((layer) => layer.id),
  );

  expect(balanced.sources).not.toHaveProperty("night-earth");
  expect(constrained.sources).not.toHaveProperty("night-earth");
  expect(balancedLayerIds).not.toContain("night-earth-texture");
  expect(balancedLayerIds).not.toContain("country-selected-glow");
  expect(constrainedLayerIds).not.toContain("night-earth-texture");
  expect(constrainedLayerIds).not.toContain("country-selected-glow");
  expect(constrainedLayerIds).not.toContain("continent-tonal-depth");
  expect(constrainedLayerIds).not.toContain("country-selected-fill");
  expect(constrainedLayerIds).not.toContain("conflict-hotspot-haze-outer");
  expect(constrainedLayerIds).toContain("country-land-base");
  expect(constrainedLayerIds).toContain("country-boundaries-local");
  expect(constrainedLayerIds).toContain("conflict-hotspot-core");
  expect(constrainedLayerIds).toContain("country-label-major-local");
});

test("renders the deterministic 1672x941 approval frame", async ({ page }) => {
  const shell = await openReadyMap(page);

  await expect(shell).toHaveAttribute("data-selected-event", "");
  await expect(shell).toHaveAttribute("data-reduced-motion", "true");
  await expect(
    page.getByRole("region", {
      name: /Interactive map of global conflict/,
    }),
  ).toHaveAttribute("data-popup-open", "false");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: /Eastern Europe: Ukraine.*Ceasefire by Sep/,
    }),
  ).toBeVisible();
  await expect(page.locator("[data-event-id]")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: /South America: Venezuela/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /South America: Colombia/ }),
  ).toBeVisible();
  await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
  await expect(page.locator('[data-market-strip="true"]')).toHaveAttribute(
    "data-market-count",
    "10",
  );
  await expect(page.locator('[data-asset-slug="ethereum"]')).toHaveAttribute(
    "href",
    "https://t.me/Drops?start=dropstab_ethereum",
  );
  await expect(
    page.locator('[data-asset-slug="brent-crude-oil"]'),
  ).toHaveAttribute(
    "href",
    "https://t.me/Drops?start=dropstab_brent-crude-oil",
  );
  await expect(
    page.locator('[data-asset-slug="brent-crude-oil"]'),
  ).toHaveAttribute("data-asset-symbol", "Oil");
  await expect(page.locator('[data-asset-symbol="Brent"]')).toHaveCount(0);
  const assetIcons = page.locator('[data-market-strip="true"] [data-icon]');
  await expect(assetIcons).toHaveCount(10);
  const iconSurfaces = await assetIcons.evaluateAll((icons) =>
    icons.map((icon) => {
      const style = getComputedStyle(icon);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopWidth: style.borderTopWidth,
      };
    }),
  );
  expect(
    iconSurfaces.every(
      (icon) =>
        icon.backgroundColor === "rgba(0, 0, 0, 0)" &&
        icon.backgroundImage !== "none" &&
        icon.borderTopWidth === "0px",
    ),
  ).toBe(true);
  const metalIconImages = await page
    .locator(
      '[data-asset-slug="gold-metal"] [data-icon], [data-asset-slug="silver-metal"] [data-icon], [data-asset-slug="copper-metal"] [data-icon]',
    )
    .evaluateAll((icons) =>
      icons.map((icon) => getComputedStyle(icon).backgroundImage),
    );
  expect(new Set(metalIconImages).size).toBe(1);
  const appleAlignment = await page
    .locator('[data-asset-slug="apple-aapl"]')
    .evaluate((asset) => {
      const icon = asset.querySelector<HTMLElement>('[data-icon="apple"]')!;
      const symbol = asset.querySelector<HTMLElement>("strong")!;
      const iconBox = icon.getBoundingClientRect();
      const symbolBox = symbol.getBoundingClientRect();
      return Math.abs(
        iconBox.top + iconBox.height / 2 -
          (symbolBox.top + symbolBox.height / 2),
      );
    });
  expect(appleAlignment).toBeLessThanOrEqual(1.5);
  await expect(
    page.locator('[data-asset-slug="bitcoin"] [data-direction="down"]'),
  ).toHaveCSS("color", "rgb(255, 100, 119)");
  await expect(
    page.locator('[data-asset-slug="gold-metal"] [data-direction="up"]'),
  ).toHaveCSS("color", "rgb(40, 217, 149)");
  await expect(shell).toHaveAttribute("data-weekly-surge-count", "0");
  await expect(page.getByTestId("weekly-surge-label")).toHaveCount(0);
  const marketTrack = page.locator('[data-market-strip-track="true"]');
  const marketTrackBox = await marketTrack.boundingBox();
  expect(marketTrackBox).not.toBeNull();
  expect(marketTrackBox!.width).toBeGreaterThanOrEqual(1_660);
  const sp500Icon = page.locator('[data-asset-slug="sp500-index"] [data-icon]');
  const sp500IconBox = await sp500Icon.boundingBox();
  expect(sp500IconBox).not.toBeNull();
  expect(sp500IconBox!.width).toBeGreaterThanOrEqual(16);
  for (const slug of [
    "gold-metal",
    "silver-metal",
    "copper-metal",
    "brent-crude-oil",
  ]) {
    const iconBox = await page
      .locator(`[data-asset-slug="${slug}"] [data-icon]`)
      .boundingBox();
    expect(iconBox).not.toBeNull();
    expect(iconBox!.width).toBeGreaterThanOrEqual(17);
  }
  await expect(
    page.getByRole("link", { name: "DropsBot", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(artifactRoot, "map-approval-1672x941.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", {
      name: /Eastern Europe: Ukraine.*Ceasefire by Sep/,
    })
    .click();
  await expect(page.getByTestId("participant-flags")).toHaveAttribute(
    "aria-label",
    /UA/,
  );
  await expect(
    page.getByTestId("participant-flags").locator('[data-country-flag="UA"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Close Eastern Europe market popup/ })
    .click();
  await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
});

test("scales hotspot prominence by market volume without loading detail tiles", async ({
  page,
}) => {
  const detailTileRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/planet/") && request.url().endsWith(".pbf")) {
      detailTileRequests.push(request.url());
    }
  });

  const shell = await openReadyMap(page);
  await expect(shell).toHaveAttribute(
    "data-hotspot-rendering",
    "maplibre-native-circles",
  );
  await expect(shell).toHaveAttribute("data-marker-glyph", "volume-circles");
  await expect(shell).toHaveAttribute("data-special-signal-count", "0");
  await expect(page.locator('[data-render-shape="circle"]')).not.toHaveCount(0);

  const markerVisuals = await page.locator("[data-marker-volume]").evaluateAll(
    (markers) =>
      markers.map((marker) => ({
        volume: Number((marker as HTMLElement).dataset.markerVolume),
        strength: Number((marker as HTMLElement).dataset.markerStrength),
        scale: Number((marker as HTMLElement).dataset.markerScale),
      })),
  );
  const ordered = markerVisuals.toSorted((left, right) => left.volume - right.volume);

  expect(ordered).toHaveLength(7);
  expect(ordered[0]!.strength).toBeGreaterThanOrEqual(0);
  expect(ordered.at(-1)!.strength).toBeLessThanOrEqual(1);
  expect(ordered.at(-1)!.scale).toBeGreaterThan(ordered[0]!.scale);
  expect(ordered.at(-1)!.scale).toBeGreaterThan(1.55);
  expect(detailTileRequests).toEqual([]);
});

test("animates rich native map beacons without DOM marker visuals", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.goto("/global-conflict-map-preview?fixture=1", {
    waitUntil: "domcontentloaded",
  });
  const shell = page.locator("main[data-map-ready]");
  await expect(shell).toHaveAttribute("data-map-ready", "true", {
    timeout: 30_000,
  });

  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("[data-hotspot-visual]")).toHaveCount(0);
  await expect(shell).toHaveAttribute(
    "data-hotspot-rendering",
    "maplibre-native-circles",
  );
  await expect(shell).toHaveAttribute("data-pulse-interval", "3000");
  await expect
    .poll(async () => Number(await shell.getAttribute("data-pulse-epoch")), {
      timeout: 2_500,
    })
    .toBeGreaterThan(0);
  const firstPulse = Number(await shell.getAttribute("data-pulse-epoch"));
  await expect
    .poll(async () => Number(await shell.getAttribute("data-pulse-epoch")), {
      // One pulse interval is 3s. Software WebGL on a loaded single-core CI
      // host can delay the callback, so allow one additional interval.
      timeout: 7_000,
    })
    .toBeGreaterThan(firstPulse);
  expect(Number(await shell.getAttribute("data-tense-zone-count"))).toBeGreaterThan(0);
  await expect(shell).toHaveAttribute("data-weekly-surge-count", "0");
  await expect(page.getByTestId("weekly-surge-label")).toHaveCount(0);
});

test("captures the regional country-and-city zoom state", async ({ page }) => {
  const shell = await openReadyMap(page);

  await page
    .locator('[data-market-event-id="middle-east-escalation"]')
    .click();
  await expect(page.getByTestId("participant-flags")).toHaveAttribute(
    "aria-label",
    "Event participants: IQ, IR, SA",
  );
  await expect(
    page.getByTestId("participant-flags").locator("[data-country-flag]"),
  ).toHaveCount(3);
  await expect(
    page.getByTestId("participant-flags").locator('[data-country-flag="IR"]'),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
    .toBeGreaterThanOrEqual(3);
  await page
    .getByRole("button", { name: /Close Middle East market popup/ })
    .click();
  await page.waitForTimeout(350);

  await page.screenshot({
    path: path.join(artifactRoot, "map-approval-regional-1672x941.png"),
    animations: "disabled",
  });
});

test("supports zoom, drag, hotspot selection and popup close", async ({ page }) => {
  const shell = await openReadyMap(page);

  const initialZoom = Number(await shell.getAttribute("data-map-zoom"));
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
    .toBeGreaterThan(initialZoom + 0.45);

  const initialLongitude = Number(await shell.getAttribute("data-map-longitude"));
  const stage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.55, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-longitude")))
    .not.toBe(initialLongitude);

  const eastAsia = page.getByRole("button", {
    name: /East Asia: Japan.*US strike before EOY/,
  });
  await eastAsia.click();
  await expect(shell).toHaveAttribute("data-selected-event", "east-asia-strike");
  await expect(page.getByTestId("conflict-popup")).toContainText("US strike before EOY?");

  const popup = page.getByTestId("conflict-popup");
  await expect(popup.getByRole("button")).toHaveCount(1);
  await expect(
    popup.getByRole("link", { name: "Track this market in DropsBot" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Close East Asia market popup/ }).click();
  await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
  await eastAsia.click();
  await expect(page.getByTestId("conflict-popup")).toBeVisible();
});

test("keeps markers and effects locked to MapLibre while dragging", async ({
  page,
}) => {
  const shell = await openReadyMap(page);
  await expect(shell).toHaveAttribute(
    "data-overlay-sync",
    "maplibre-native",
  );
  await expect(page.locator("canvas")).toHaveCount(1);

  const marker = page.locator('[data-event-id="south-america-venezuela"]');
  const markerTarget = marker.locator("button");
  const stage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const markerBefore = await marker.boundingBox();
  const stageBox = await stage.boundingBox();
  expect(markerBefore).not.toBeNull();
  expect(stageBox).not.toBeNull();
  if (!markerBefore || !stageBox) return;

  const dragDistance = 104;
  const startX = stageBox.x + stageBox.width * 0.45;
  const startY = stageBox.y + stageBox.height * 0.48;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + dragDistance, { steps: 8 });
  await expect(shell).toHaveAttribute("data-map-moving", "true");
  await expect(markerTarget).toBeHidden();
  await page.mouse.up();
  await expect(shell).toHaveAttribute("data-map-moving", "false");
  await expect(markerTarget).toBeVisible();
  await expect
    .poll(async () => {
      const markerAfter = await marker.boundingBox();
      return markerAfter
        ? Math.abs(markerAfter.y - markerBefore.y - dragDistance)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(4);
});

test("keeps event dates together and shows weekly odds only for the selected event", async ({
  page,
}) => {
  const shell = await openReadyMap(page);
  await expect(shell).toHaveAttribute("data-weekly-surge-count", "0");
  await expect(page.getByTestId("weekly-surge-label")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: /Eastern Europe: Ukraine.*Ceasefire by Sep/,
    })
    .click();
  await expect(page.getByTestId("popup-weekly-change")).toContainText("+12%");

  await page
    .getByRole("button", { name: /South America: Venezuela/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(shell).toHaveAttribute(
    "data-selected-event",
    "south-america-venezuela",
  );
  const title = await page
    .locator("#preview-market-south-america-venezuela")
    .textContent();
  expect(title).toContain("by\u00a0December\u00a031,\u00a02026");
});

test("reaches the maximum map zoom with the mouse wheel", async ({ page }) => {
  // This test owns the zoom interaction, not the upstream tile service. A
  // valid empty vector-tile response keeps software WebGL deterministic while
  // the regional rendering path remains covered by the screenshot test above.
  await page.route("https://tiles.openfreemap.org/planet/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  });
  const shell = await openReadyMap(page);
  const stage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let index = 0; index < 7; index += 1) {
    const currentZoom = Number(await shell.getAttribute("data-map-zoom"));
    if (currentZoom >= 6.95) break;
    await page.mouse.wheel(0, -2_400);
    await expect
      .poll(async () => Number(await shell.getAttribute("data-map-zoom")), {
        timeout: 8_000,
      })
      .toBeGreaterThanOrEqual(Math.min(6.95, currentZoom + 0.5));
  }
  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-zoom")), {
      timeout: 8_000,
    })
    .toBeGreaterThanOrEqual(6.95);
});

test("serves a volume-filtered read-only market feed", async ({ request }) => {
  const response = await request.get("/api/global-conflict-events");
  expect(response.ok()).toBeTruthy();
  const feed = (await response.json()) as {
    dataMode: "live" | "fallback";
    minimumVolume: number;
    events: Array<{
      volume: number;
      dataOrigin: "polymarket" | "fixture";
      marketUrl: string | null;
      evidenceStatus:
        | "exact-place"
        | "country-anchor"
        | "regional-anchor"
        | "illustrative-fixture";
      coordinates: [number, number];
      locationId: string;
      yesOdds: number;
      noOdds: number;
      priceChange7d: number | null;
      endDate: string | null;
      geographyKind: "place" | "country" | "regional" | "alliance";
      countryFeatureIds: string[];
      title: string;
    }>;
  };

  expect(feed.minimumVolume).toBe(50_000);
  expect(feed.events.length).toBeGreaterThan(0);
  expect(feed.events.every((event) => event.volume >= feed.minimumVolume)).toBe(
    true,
  );
  expect(
    feed.events.every((event) => event.yesOdds > 0 && event.noOdds > 0),
  ).toBe(true);
  expect(
    feed.events.every(
      (event) =>
        event.endDate === null ||
        !Number.isFinite(Date.parse(event.endDate)) ||
        Date.parse(event.endDate) > Date.now(),
    ),
  ).toBe(true);
  expect(
    feed.events.every(
      (event) =>
        event.locationId.length > 0 &&
        Number.isFinite(event.coordinates[0]) &&
        Number.isFinite(event.coordinates[1]) &&
        [
          "exact-place",
          "country-anchor",
          "regional-anchor",
          "illustrative-fixture",
        ].includes(event.evidenceStatus),
    ),
  ).toBe(true);
  expect(
    feed.events.every((event) =>
      ["place", "country", "regional", "alliance"].includes(
        event.geographyKind,
      ),
    ),
  ).toBe(true);
  if (feed.dataMode === "live") {
    expect(feed.events.every((event) => event.dataOrigin === "polymarket")).toBe(
      true,
    );
    expect(
      feed.events.every(
        (event) =>
          event.marketUrl === null ||
          /^https:\/\/polymarket\.com\/event\/[a-z0-9-]+\?via=drops1$/.test(
            event.marketUrl,
          ),
      ),
    ).toBe(true);
    const natoEvents = feed.events.filter((event) => /\bNATO\b/i.test(event.title));
    expect(
      natoEvents.every(
        (event) =>
          event.geographyKind === "alliance" &&
          event.countryFeatureIds.includes("USA"),
      ),
    ).toBe(true);
  }
});

test("serves the approved map on the canonical public route", async ({ page }) => {
  const shell = await openReadyMap(page, "/global-conflict-map");
  await expect(shell).toHaveAttribute("data-minimum-volume", "50000");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "DropsBot", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-market-strip="true"]')).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://oddsfront.com/brand/oddsfront-social-preview-v1.png",
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    "https://oddsfront.com/brand/oddsfront-social-preview-v1.png",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/brand/dropsbot-app-icon-v4.svg",
  );

  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.ok()).toBeTruthy();
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  const faviconSvg = await favicon.text();
  expect(faviconSvg).toContain('viewBox="0 0 64 64"');
  expect(faviconSvg).toContain('fill="#020A16"');

  const socialPreview = await page.request.get(
    "/brand/oddsfront-social-preview-v1.png",
  );
  expect(socialPreview.ok()).toBeTruthy();
  expect(socialPreview.headers()["content-type"]).toContain("image/png");
  const previewBytes = await socialPreview.body();
  expect([...previewBytes.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "OddsFront by DropsBot",
  );
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
    "content",
    "OddsFront",
  );

  const documentResponse = await page.request.get("/global-conflict-map");
  const documentHeaders = documentResponse.headers();
  expect(documentHeaders["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(documentHeaders["content-security-policy"]).toContain(
    "connect-src 'self' https://tiles.openfreemap.org",
  );
  expect(documentHeaders["x-content-type-options"]).toBe("nosniff");
  expect(documentHeaders["x-frame-options"]).toBe("DENY");
  expect(documentHeaders["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(documentHeaders["permissions-policy"]).toContain("camera=()");

  const feedResponse = await page.request.get("/api/global-conflict-events");
  expect(feedResponse.headers()["cdn-cache-control"]).toContain(
    "stale-if-error=900",
  );
  expect(feedResponse.headers()["cdn-cache-control"]).toContain(
    "stale-while-revalidate=60",
  );
});

test("serves the live map and fresh social metadata at the root URL", async ({
  page,
}) => {
  let duplicateFeedRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/global-conflict-events") {
      duplicateFeedRequests += 1;
    }
  });
  const shell = await openReadyMap(page, "/");
  await expect(shell).toHaveAttribute("data-map-ready", "true");
  await page.waitForTimeout(1_800);
  expect(duplicateFeedRequests).toBe(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://oddsfront.com",
  );
  await expect(
    page.locator('meta[property="og:image:secure_url"]'),
  ).toHaveAttribute(
    "content",
    "https://oddsfront.com/brand/oddsfront-social-preview-v1.png",
  );
  await expect(page.locator('link[rel="image_src"]')).toHaveAttribute(
    "href",
    "https://oddsfront.com/brand/oddsfront-social-preview-v1.png",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  const manifest = await page.request.get("/site.webmanifest");
  expect(manifest.status()).toBe(404);
  const robots = await page.request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  expect(await robots.text()).toContain("Allow: /");
  expect(await robots.text()).toContain("Host: https://oddsfront.com");
  const font = await page.request.get("/fonts/inter-latin.var.woff2");
  expect(font.ok()).toBeTruthy();
  expect(font.headers()["cache-control"]).toContain("immutable");
});

test("keeps every qualified event visible at the world view and regional zoom", async ({
  page,
}) => {
  const shell = await openReadyMap(page, "/global-conflict-map");
  const eventCount = Number(await shell.getAttribute("data-event-count"));
  const initialVisibleCount = Number(
    await shell.getAttribute("data-visible-event-count"),
  );

  expect(eventCount).toBeGreaterThan(0);
  expect(initialVisibleCount).toBeGreaterThan(0);
  expect(initialVisibleCount).toBe(eventCount);
  const markerCount = Number(await shell.getAttribute("data-visible-marker-count"));
  expect(markerCount).toBeGreaterThan(0);
  expect(markerCount).toBeLessThanOrEqual(eventCount);
  await expect(shell).toHaveAttribute("data-minimum-volume", "50000");

  await page.screenshot({
    path: path.join(artifactRoot, "map-live-1672x941.png"),
    animations: "disabled",
  });

  if ((await shell.getAttribute("data-feed-mode")) === "live") {
    await page
      .locator("[data-market-event-id]")
      .first()
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(
      page.getByRole("link", { name: "View this event on Polymarket" }),
    ).toHaveAttribute(
      "href",
      /^https:\/\/polymarket\.com\/event\/[a-z0-9-]+\?via=drops1$/,
    );
    await page
      .getByTestId("conflict-popup")
      .getByRole("button", { name: /Close .* market popup/ })
      .click();
    await expect
      .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
      .toBeGreaterThanOrEqual(3);
  }

  for (let index = 0; index < 8; index += 1) {
    const previousZoom = Number(await shell.getAttribute("data-map-zoom"));
    if (previousZoom <= 1.72) break;
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect
      .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
      .toBeLessThan(previousZoom - 0.2);
  }

  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
    .toBeLessThanOrEqual(1.72);
  await expect
    .poll(async () => Number(await shell.getAttribute("data-visible-event-count")))
    .toBe(eventCount);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => Number(await shell.getAttribute("data-visible-event-count")))
    .toBe(eventCount);
});

test("groups co-located alliance events behind popup pager arrows", async ({
  page,
}) => {
  const fixture = getConflictPreviewFixtureFeed();
  const groupedEvents = fixture.events.slice(0, 2).map((event, index) => ({
    ...event,
    id: `polymarket-${25_413 + index}`,
    title:
      index === 0
        ? "Will Russia invade a NATO country by December 31, 2026?"
        : "NATO x Russia military clash by December 31, 2026?",
    locationId: "baltic-region",
    locationLabel: "NATO eastern flank",
    coordinates: [24.6, 55.4] as [number, number],
    countryCodes: ["RU", "PL", "LT", "LV", "EE", "US"],
    countryFeatureIds: ["RUS", "POL", "LTU", "LVA", "EST", "USA"],
    geographyKind: "alliance" as const,
    dataOrigin: "polymarket" as const,
    evidenceStatus: "regional-anchor" as const,
    marketUrl: `https://polymarket.com/event/nato-test-${index}?via=drops1`,
    priceChange1h: null,
    priceChange24h: null,
    volume: index === 0 ? 1_000_000 : 10_000_000,
  }));
  const events = [
    {
      ...fixture.events[2]!,
      id: "polymarket-25412",
      dataOrigin: "polymarket" as const,
      marketUrl: "https://polymarket.com/event/unrelated-test?via=drops1",
    },
    ...groupedEvents,
  ];

  await page.route("**/api/global-conflict-events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...fixture,
        dataMode: "live",
        events,
      }),
    });
  });

  const shell = await openReadyMap(page, "/global-conflict-map");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(shell).toHaveAttribute("data-event-count", "3");
  await expect(shell).toHaveAttribute("data-visible-marker-count", "2");
  await expect(shell).toHaveAttribute("data-alliance-event-count", "2");
  await expect(shell).toHaveAttribute(
    "data-highlighted-country-ids",
    /(?:^|,)USA(?:,|$)/,
  );

  const allianceMarkers = page.locator('[data-geography-kind="alliance"]');
  await expect(allianceMarkers).toHaveCount(1);
  await expect(allianceMarkers).toHaveAttribute("data-marker-offset", "0.0,0.0");

  await page
    .getByRole("button", { name: /NATO eastern flank.*military clash/ })
    .click();
  await expect(shell).toHaveAttribute("data-selected-event", "polymarket-25414");
  const popup = page.getByTestId("conflict-popup");
  await expect(popup).toContainText("Market 1 of 2");
  await expect(
    popup.getByRole("link", { name: "Track this market in DropsBot" }),
  ).toHaveAttribute(
    "href",
    "https://t.me/Drops?start=TRACKpm_nato-test-1",
  );
  await expect(
    popup.getByRole("link", { name: "Track this market in DropsBot" }),
  ).toContainText("Track in DropsBot");
  await popup.getByRole("button", { name: "Next market at this location" }).click();
  await expect(shell).toHaveAttribute("data-selected-event", "polymarket-25413");
  await expect(popup).toContainText("Market 2 of 2");
});

test("fills the rail with 5% daily and 20% weekly moves in both directions", async ({
  page,
}) => {
  const fixture = getConflictPreviewFixtureFeed();
  const updatedAt = new Date().toISOString();
  const liveFeed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    events: fixture.events.slice(0, 5).map((event, index) => ({
      ...event,
      id: `polymarket-${7_000 + index}`,
      dataOrigin: "polymarket" as const,
      evidenceStatus: "country-anchor" as const,
      marketUrl: `https://polymarket.com/event/rolling-test-${index}`,
      updatedAt,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      marketConditionId: mockConditionId(7_000 + index),
      volume: [8_161_752, 483_019, 17_151_386, 99_999, 8_886_800][index]!,
      volume24h: [1, 2, 0, 20_000, 0][index]!,
      priceChange1h: [0.75, -0.81, 0.66, 0.9, -0.72][index]!,
      priceChange24h: [0.05, -0.05, 0.06, 0.8, 0.04996][index]!,
      priceChange7d: [0.199, -0.2, 0.25, -0.9, -0.19996][index]!,
    })),
  };

  await page.route("**/api/global-conflict-events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveFeed),
    });
  });
  await page.route("**/api/global-conflict-activity?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dataMode: "live",
        updatedAt,
        expiresAfterSeconds: 1_800,
        sourceLabel: "Polymarket Data API",
        items: [],
      }),
    });
  });

  await openActivityRailPage(page);
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toBeVisible();
  expect(await rail.evaluate((element) => element.closest("main") === null)).toBe(
    true,
  );
  await expect(rail).toHaveAttribute("data-activity-count", "3");
  await expect(rail).toContainText("Odds +25.0%");
  await expect(rail).toContainText("Odds -20.0%");
  await expect(rail).toContainText("Odds +5.0%");
  await expect(rail).not.toContainText(" pp");
  await expect(rail).not.toContainText("Volume");
  await expect(rail).not.toContainText("1h");
  await expect(rail.locator('[data-activity-source="rolling"]')).toHaveCount(3);
  const oddsMetrics = rail.locator(
    '[data-activity-kind^="odds-"] [data-activity-metric]',
  );
  await expect(oddsMetrics).toHaveCount(3);
  for (const metric of await oddsMetrics.all()) {
    await expect(metric).toHaveText(/^YES \d+%$/);
    await expect(metric).toHaveCSS("white-space", "nowrap");
  }
  await expect(rail.locator('[data-activity-kind="high-volume"]')).toHaveCount(0);
  const oddsCard = rail.locator('[data-activity-kind^="odds-"]').first();
  await expect(rail.locator("[data-activity-location]")).toHaveCount(0);
  await expect(oddsCard.locator("[data-activity-flags]")).toBeVisible();
  const oddsLayout = await oddsCard.evaluate((card) => {
    const footer = card.querySelector<HTMLElement>("[data-activity-footer]");
    const flags = card.querySelector<HTMLElement>("[data-activity-flags]");
    const metric = card.querySelector<HTMLElement>("[data-activity-metric]");
    const actions = card.querySelector<HTMLElement>("[data-activity-actions]");
    if (!footer || !flags || !metric || !actions) return null;

    const footerRect = footer.getBoundingClientRect();
    const flagsRect = flags.getBoundingClientRect();
    const metricRect = metric.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const footerStyle = getComputedStyle(footer);
    return {
      display: footerStyle.display,
      flexWrap: footerStyle.flexWrap,
      footerLeft: footerRect.left,
      footerRight: footerRect.right,
      footerHeight: footerRect.height,
      flagsLeft: flagsRect.left,
      flagsRight: flagsRect.right,
      flagsCenter: flagsRect.top + flagsRect.height / 2,
      metricLeft: metricRect.left,
      metricRight: metricRect.right,
      metricCenter: metricRect.top + metricRect.height / 2,
      actionsLeft: actionsRect.left,
      actionsRight: actionsRect.right,
      actionsCenter: actionsRect.top + actionsRect.height / 2,
    };
  });
  expect(oddsLayout).not.toBeNull();
  if (oddsLayout) {
    expect(oddsLayout.display).toBe("flex");
    expect(oddsLayout.flexWrap).toBe("nowrap");
    expect(oddsLayout.footerHeight).toBeLessThanOrEqual(25);
    expect(oddsLayout.flagsLeft).toBeGreaterThanOrEqual(oddsLayout.footerLeft);
    expect(oddsLayout.flagsRight).toBeLessThanOrEqual(oddsLayout.metricLeft);
    expect(oddsLayout.metricRight).toBeLessThanOrEqual(oddsLayout.actionsLeft);
    expect(oddsLayout.actionsRight).toBeLessThanOrEqual(
      oddsLayout.footerRight + 1,
    );
    expect(Math.abs(oddsLayout.flagsCenter - oddsLayout.metricCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(oddsLayout.metricCenter - oddsLayout.actionsCenter)).toBeLessThanOrEqual(1);
  }
  await expect(rail).not.toContainText(liveFeed.events[3]!.title);
  await expect(rail).not.toContainText(liveFeed.events[4]!.title);
  await expect(rail.locator('[data-activity-window="7d"]')).toHaveCount(2);
  await expect(rail.locator('[data-activity-window="24h"]')).toHaveCount(1);
});

test("batches trade-watch coverage across every eligible $100K market", async ({
  page,
}) => {
  const fixture = getConflictPreviewFixtureFeed();
  const updatedAt = new Date().toISOString();
  const liveFeed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    events: Array.from({ length: 136 }, (_, index) => ({
      ...fixture.events[index % fixture.events.length]!,
      id: `polymarket-${900_000 + index}`,
      dataOrigin: "polymarket" as const,
      evidenceStatus: "country-anchor" as const,
      marketUrl: `https://polymarket.com/event/batched-activity-${index}`,
      updatedAt,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      marketConditionId: mockConditionId(900_000 + index),
      volume: 100_000 + index,
      volume24h: 1,
      priceChange1h: null,
      priceChange24h: 0.01,
      priceChange7d: 0.01,
    })),
  };
  const activityMarketIdQueries: string[][] = [];

  await page.route("**/api/global-conflict-events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveFeed),
    });
  });
  await page.route("**/api/global-conflict-activity?**", async (route) => {
    activityMarketIdQueries.push(
      (new URL(route.request().url()).searchParams.get("marketIds") ?? "")
        .split(",")
        .filter(Boolean),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dataMode: "live",
        updatedAt,
        expiresAfterSeconds: 900,
        sourceLabel: "Polymarket Data API",
        items: [],
      }),
    });
  });

  await openActivityRailPage(page);
  await expect.poll(() => activityMarketIdQueries.length).toBe(2);
  expect(
    activityMarketIdQueries.map((marketIds) => marketIds.length).sort((a, b) => a - b),
  ).toEqual([36, 100]);
  expect([...new Set(activityMarketIdQueries.flat())].sort()).toEqual(
    liveFeed.events.map((event) => event.marketConditionId).sort(),
  );
});

test("does not reanimate the same rolling signal after a feed refresh", async ({
  page,
}) => {
  const fixture = getConflictPreviewFixtureFeed();
  const firstUpdatedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const refreshedAt = new Date().toISOString();
  const event = {
    ...fixture.events[0]!,
    id: "polymarket-777001",
    dataOrigin: "polymarket" as const,
    evidenceStatus: "country-anchor" as const,
    marketUrl: "https://polymarket.com/event/stable-rolling-alert",
    volume: 2_000_000,
    volume24h: 50_000,
    priceChange1h: 0.9,
    priceChange24h: 0.22,
    updatedAt: firstUpdatedAt,
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    marketConditionId: mockConditionId(777_001),
  };
  const firstFeed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt: firstUpdatedAt,
    sourceLabel: "Polymarket Gamma API",
    events: [event],
  };
  const refreshedFeed = {
    ...firstFeed,
    updatedAt: refreshedAt,
    events: [{ ...event, priceChange24h: 0.25, updatedAt: refreshedAt }],
  };
  let currentFeed = firstFeed;
  let feedRequestCount = 0;

  await page.route("**/api/global-conflict-events", async (route) => {
    feedRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentFeed),
    });
  });
  await page.route("**/api/global-conflict-activity?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dataMode: "live",
        updatedAt: refreshedAt,
        expiresAfterSeconds: 1_800,
        sourceLabel: "Polymarket Data API",
        items: [],
      }),
    });
  });

  await openActivityRailPage(page);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => feedRequestCount).toBeGreaterThanOrEqual(1);
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toHaveAttribute("data-feed-updated-at", firstUpdatedAt);
  const rollingCard = rail.locator(
    '[data-activity-source="rolling"][data-event-id="polymarket-777001"]',
  );
  await expect(rollingCard).toBeVisible();
  const initialExpiry = await rollingCard.getAttribute("data-expires-at");
  expect(initialExpiry).not.toBeNull();

  currentFeed = refreshedFeed;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => feedRequestCount).toBeGreaterThanOrEqual(2);
  await expect(rail).toHaveAttribute("data-feed-updated-at", refreshedAt);
  await expect(rollingCard).toHaveAttribute("data-expires-at", initialExpiry!);
});

test("shows 5% daily and 20% weekly moves with referral-safe buys from $200K", async ({
  page,
}) => {
  const fixture = getConflictPreviewFixtureFeed();
  const updatedAt = new Date().toISOString();
  const liveFeed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    events: fixture.events.map((event, index) => ({
      ...event,
      id: `polymarket-${8_000 + index}`,
      dataOrigin: "polymarket" as const,
      evidenceStatus: "country-anchor" as const,
      marketUrl: `https://polymarket.com/event/activity-test-${index}`,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      marketConditionId: mockConditionId(8_000 + index),
      countryCodes:
        index === 4 ? ["US", "IR", "OM"] : event.countryCodes,
      volume: index === 2 ? 900_000 : event.volume,
      volume24h: index === 1 ? 1 : event.volume24h,
      priceChange1h: index === 0 ? 0.9 : index === 3 ? -0.8 : null,
      priceChange24h: index === 1 ? -0.08 : index === 2 ? 0.06 : 0.049,
      priceChange7d: index === 1 ? -0.19 : index === 2 ? 0.25 : null,
    })),
  };
  const activityMarketIdQueries: string[][] = [];
  let conflictFeedRequestCount = 0;
  const validTradeOccurredAt = new Date(Date.now() - 60_000).toISOString();

  await page.route("**/api/global-conflict-events", async (route) => {
    conflictFeedRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveFeed),
    });
  });
  await page.route("**/api/global-conflict-activity?**", async (route) => {
    activityMarketIdQueries.push(
      (new URL(route.request().url()).searchParams.get("marketIds") ?? "")
        .split(",")
        .filter(Boolean)
        .sort(),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dataMode: "live",
        updatedAt,
        expiresAfterSeconds: 900,
        sourceLabel: "Polymarket Data API",
        items: [
          {
            id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            kind: "large-sell",
            title: liveFeed.events[3]!.title,
            outcome: "YES",
            outcomeOdds: 92,
            marketConditionId: liveFeed.events[3]!.marketConditionId,
            notional: 930_000,
            occurredAt: new Date(Date.now() - 30_000).toISOString(),
            marketUrl: liveFeed.events[3]!.marketUrl,
          },
          {
            id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            kind: "large-buy",
            title: liveFeed.events[4]!.title,
            outcome: "YES",
            outcomeOdds: 100,
            marketConditionId: liveFeed.events[4]!.marketConditionId,
            notional: 250_000,
            occurredAt: validTradeOccurredAt,
            marketUrl: liveFeed.events[4]!.marketUrl,
          },
          {
            id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            kind: "large-buy",
            title: liveFeed.events[3]!.title,
            outcome: "YES",
            outcomeOdds: 44,
            marketConditionId: liveFeed.events[3]!.marketConditionId,
            notional: 199_999,
            occurredAt: validTradeOccurredAt,
            marketUrl: liveFeed.events[3]!.marketUrl,
          },
        ],
      }),
    });
  });

  await openActivityRailPage(page);
  await expect.poll(() => conflictFeedRequestCount).toBeGreaterThanOrEqual(1);
  const expectedActivityMarketIds = liveFeed.events
    .filter((event) => event.volume >= 100_000)
    .map((event) => event.marketConditionId)
    .filter((marketId): marketId is string => Boolean(marketId))
    .sort();
  await expect
    .poll(() =>
      activityMarketIdQueries.some(
        (marketIds) =>
          JSON.stringify(marketIds) ===
          JSON.stringify(expectedActivityMarketIds),
      ),
    )
    .toBe(true);
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute("data-activity-count", "3");
  await expect(rail).not.toContainText("July 31");
  await expect(
    rail
      .locator('[data-activity-kind="large-buy"]')
      .locator("strong"),
  ).toHaveText("Large BUY $250K");
  await expect(
    rail
      .locator('[data-activity-kind="large-buy"]')
      .locator("[data-activity-metric]"),
  ).toHaveText("YES 100%");
  await expect(
    rail
      .locator('[data-activity-kind="large-buy"]')
      .locator("[data-activity-metric]"),
  ).toHaveAttribute("aria-label", "Trade execution odds");
  await expect(rail).toContainText("Odds +25.0%");
  await expect(rail).toContainText("Odds -8.0%");
  await expect(rail).not.toContainText(liveFeed.events[3]!.title);
  await expect(rail.locator('[data-activity-kind="large-sell"]')).toHaveCount(0);
  await expect(rail).not.toContainText("Volume");
  await expect(rail).not.toContainText("1h");
  await expect(rail).toContainText("7d");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => conflictFeedRequestCount).toBeGreaterThanOrEqual(2);
  await expect(rail).toHaveAttribute("data-activity-count", "3");
  await expect(rail).not.toContainText(" pp");
  await expect(rail).toContainText("24h");
  await expect(
    rail.locator('[data-activity-kind="odds-rise"]'),
  ).toHaveAttribute("data-activity-direction", "up");
  await expect(
    rail.locator('[data-activity-kind="odds-rise"]'),
  ).toHaveAttribute("style", /--activity-tone: #22DF91/i);
  await expect(rail.locator('[data-activity-kind="odds-drop"]')).toHaveCount(1);
  await expect(rail.locator("[data-country-flag]")).not.toHaveCount(0);
  await expect(
    rail.locator(
      '[data-activity-kind="large-buy"] [data-country-flag="US"]',
    ),
  ).toBeVisible();

  const expiry = Date.parse(
    (await rail
      .locator('[data-activity-kind="large-buy"]')
      .getAttribute("data-expires-at")) ??
      "",
  );
  expect(expiry - Date.parse(validTradeOccurredAt)).toBe(15 * 60 * 1_000);

  const trackLinks = rail.getByRole("link", {
    name: "Track this market in DropsBot",
  });
  await expect(trackLinks).toHaveCount(3);
  for (const trackLink of await trackLinks.all()) {
    await expect(trackLink).toHaveText("Track");
  }
  await expect(
    rail
      .locator('[data-activity-kind="large-buy"]')
      .getByRole("link", { name: "Track this market in DropsBot" }),
  ).toHaveAttribute(
    "href",
    "https://t.me/Drops?start=TRACKpm_activity-test-4",
  );
  const marketLinks = rail.getByRole("link", {
    name: "Open activity market on Polymarket via DropsBot",
  });
  await expect(marketLinks).toHaveCount(3);
  await expect(
    rail
      .locator('[data-activity-kind="large-buy"]')
      .getByRole("link", {
        name: "Open activity market on Polymarket via DropsBot",
      }),
  ).toHaveAttribute(
    "href",
    "https://polymarket.com/event/activity-test-4?via=drops1",
  );
  for (const marketLink of await marketLinks.all()) {
    await expect(marketLink).toHaveAttribute("href", /\?via=drops1$/);
    await expect(marketLink).toHaveAttribute("data-referral-code", "drops1");
  }

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeStage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const [landscapeStageBox, landscapeRailBox, landscapeControlsBox] =
    await Promise.all([
      landscapeStage.boundingBox(),
      rail.boundingBox(),
      page.getByLabel("Map controls").boundingBox(),
    ]);
  expect(landscapeStageBox).not.toBeNull();
  expect(landscapeRailBox).not.toBeNull();
  expect(landscapeControlsBox).not.toBeNull();
  if (landscapeStageBox && landscapeRailBox && landscapeControlsBox) {
    const stageBottom = landscapeStageBox.y + landscapeStageBox.height;
    expect(stageBottom).toBeLessThanOrEqual(391);
    expect(landscapeRailBox.y + landscapeRailBox.height).toBeLessThanOrEqual(
      stageBottom + 1,
    );
    expect(
      landscapeControlsBox.y + landscapeControlsBox.height,
    ).toBeLessThanOrEqual(stageBottom + 1);
  }

  await page.setViewportSize({ width: 390, height: 664 });
  await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
  await expect(rail).toBeVisible();
  const stage = page.getByRole("region", {
    name: /Interactive map of global conflict/,
  });
  const [stageBox, railBox, controlsBox] = await Promise.all([
    stage.boundingBox(),
    rail.boundingBox(),
    page.getByLabel("Map controls").boundingBox(),
  ]);
  expect(stageBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  if (stageBox && railBox && controlsBox) {
    const stageBottom = stageBox.y + stageBox.height;
    expect(Math.abs(stageBottom - railBox.y - railBox.height - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageBottom - controlsBox.y - controlsBox.height - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(390 - railBox.x - railBox.width - 16)).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 320, height: 664 });
  const narrowCard = rail.locator("[data-notice-id]:visible").first();
  await expect(
    narrowCard.getByRole("link", { name: "Track this market in DropsBot" }),
  ).toBeVisible();
  await expect(
    narrowCard.getByRole("link", {
      name: "Open activity market on Polymarket via DropsBot",
    }),
  ).toBeVisible();
  const narrowLayout = await narrowCard.evaluate((card) => {
    const footer = card.querySelector<HTMLElement>("[data-activity-footer]");
    const flags = card.querySelector<HTMLElement>("[data-activity-flags]");
    const metric = card.querySelector<HTMLElement>("[data-activity-metric]");
    const actions = card.querySelector<HTMLElement>("[data-activity-actions]");
    if (!footer || !flags || !metric || !actions) return null;
    const footerRect = footer.getBoundingClientRect();
    const rects = [flags, metric, actions].map((node) =>
      node.getBoundingClientRect(),
    );
    return {
      footerLeft: footerRect.left,
      footerRight: footerRect.right,
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.max(...rects.map((rect) => rect.top)),
      bottom: Math.min(...rects.map((rect) => rect.bottom)),
      documentOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(narrowLayout).not.toBeNull();
  if (narrowLayout) {
    expect(narrowLayout.left).toBeGreaterThanOrEqual(narrowLayout.footerLeft);
    expect(narrowLayout.right).toBeLessThanOrEqual(narrowLayout.footerRight + 1);
    expect(narrowLayout.top).toBeLessThan(narrowLayout.bottom);
    expect(narrowLayout.documentOverflow).toBe(0);
  }

  await page
    .locator('[data-market-event-id="polymarket-8001"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId("conflict-popup")).toBeVisible();
  await expect(rail).toBeHidden();
  await page
    .getByTestId("conflict-popup")
    .getByRole("button", { name: /Close .* market popup/ })
    .click();
  await expect(rail).toBeVisible();

  const dismissedNoticeId = await rail
    .locator("[data-notice-id]")
    .first()
    .getAttribute("data-notice-id");
  expect(dismissedNoticeId).not.toBeNull();
  await rail
    .getByRole("button", { name: "Dismiss activity notification" })
    .first()
    .click();
  await expect(
    rail.locator(`[data-notice-id="${dismissedNoticeId}"]`),
  ).toHaveCount(0);
});

test("refreshes a stale initial conflict feed immediately", async ({ page }) => {
  const fixture = getConflictPreviewFixtureFeed();
  const updatedAt = new Date().toISOString();
  const liveFeed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt,
    sourceLabel: "Polymarket Gamma API",
    events: fixture.events.map((event, index) => ({
      ...event,
      id: `polymarket-${9_000 + index}`,
      dataOrigin: "polymarket" as const,
      evidenceStatus: "country-anchor" as const,
      marketUrl: `https://polymarket.com/event/stale-refresh-${index}`,
      updatedAt,
    })),
  };
  let refreshCount = 0;
  let releaseCountrySource!: () => void;
  const countrySourceGate = new Promise<void>((resolve) => {
    releaseCountrySource = resolve;
  });

  await page.route(
    "**/maps/ne_110m_admin_0_countries.render.geojson",
    async (route) => {
      await countrySourceGate;
      await route.continue();
    },
  );

  await page.route("**/api/global-conflict-events", async (route) => {
    refreshCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveFeed),
    });
  });
  await page.route("**/api/global-conflict-activity?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dataMode: "live",
        updatedAt,
        expiresAfterSeconds: 1_800,
        sourceLabel: "Polymarket Data API",
        items: [],
      }),
    });
  });

  await page.goto("/global-conflict-map-preview", {
    waitUntil: "domcontentloaded",
  });
  const shell = page.locator("main[data-map-ready]");
  await expect.poll(() => refreshCount).toBeGreaterThan(0);
  await expect(shell).toHaveAttribute("data-map-ready", "false");
  releaseCountrySource();
  await expect(shell).toHaveAttribute("data-feed-mode", "live", {
    timeout: 5_000,
  });
  await expect(shell).toHaveAttribute("data-map-ready", "true", {
    timeout: 30_000,
  });
});

test("builds bounded DropsBot deep links with a shared Hormuz override", () => {
  expect(
    buildDropsBotTrackUrl(
      "https://polymarket.com/event/how-many-different-countries-will-israel-strike-in-2026?via=drops1",
    ),
  ).toBe(
    "https://t.me/Drops?start=TRACKpm_how-many-different-countries-will-israel-strike-in-2026",
  );
  expect(
    buildDropsBotTrackUrl(
      "https://polymarket.com/event/strait-of-hormuz-traffic-returns-to-normal-by-december-31",
    ),
  ).toBe("https://t.me/Drops?start=pm_Hormuz");
  expect(
    buildDropsBotTrackUrl(
      "https://polymarket.com/event/strait-of-hormuz-traffic-returns-to-normal-by-august-31-20260702154212320",
    ),
  ).toBe("https://t.me/Drops?start=pm_Hormuz");
  expect(
    buildDropsBotTrackUrl(
      "https://polymarket.com/event/strait-of-hormuz-traffic-returns-to-normal-by-september-30-20260702154339440",
    ),
  ).toBe("https://t.me/Drops?start=pm_Hormuz");
  expect(
    buildDropsBotTrackUrl(
      "https://polymarket.com/event/us-x-iran-effective-ceasfire-byptptpt-2-week-pause-20260715194822042",
    ),
  ).toBeNull();
  expect(
    buildDropsBotTrackUrl(
      `https://polymarket.com/event/${"a".repeat(57)}`,
    ),
  ).toBeNull();
  expect(buildDropsBotTrackUrl(null)).toBeNull();
});

test("builds canonical Dropstab and DropsBot asset links", () => {
  expect(buildDropsBotAssetTrackUrl("ethereum")).toBe(
    "https://t.me/Drops?start=dropstab_ethereum",
  );
  expect(buildDropsBotAssetTrackUrl("brent-crude-oil")).toBe(
    "https://t.me/Drops?start=dropstab_brent-crude-oil",
  );
  expect(buildDropsBotAssetTrackUrl("sp500-index")).toBe(
    "https://t.me/Drops?start=dropstab_sp500-index",
  );
  expect(buildDropstabAssetUrl("apple-aapl")).toBe(
    "https://dropstab.com/coins/apple-aapl",
  );
  expect(buildDropsBotAssetTrackUrl("../bad-slug")).toBeNull();
  expect(buildDropstabAssetUrl("https://example.com")).toBeNull();
});

test("automatically geolocates unseen conflict events without per-event rules", () => {
  const event = (
    id: string,
    title: string,
    tags: NonNullable<GammaEvent["tags"]>,
  ): GammaEvent => ({
    id,
    title,
    slug: `automatic-conflict-${id}`,
    active: true,
    closed: false,
    archived: false,
    volume: 2_400_000,
    volume24hr: 120_000,
    liquidity: 380_000,
    updatedAt: "2026-08-07T12:00:00Z",
    tags,
    markets: [
      {
        id: `market-${id}`,
        conditionId: mockConditionId(Number(id)),
        question: title,
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.41","0.59"]',
        volume: 2_400_000,
        volume24hr: 120_000,
        liquidity: 380_000,
        active: true,
        closed: false,
        archived: false,
        acceptingOrders: true,
        endDate: "2027-12-31T23:59:59Z",
        updatedAt: "2026-08-07T12:00:00Z",
        oneHourPriceChange: 0.25,
        oneDayPriceChange: 0.28,
        oneWeekPriceChange: 0.32,
      },
    ],
  });

  const newCountryPair = normalizeConflictPreviewEvent(
    event(
      "900001",
      "Will Rwanda launch a military operation in Burundi before 2027?",
      [
        { slug: "geopolitics", label: "Geopolitics" },
        { slug: "armed-conflict", label: "Armed Conflict" },
        { slug: "rwanda", label: "Rwanda" },
        { slug: "burundi", label: "Burundi" },
      ],
    ),
  );
  expect(newCountryPair).toMatchObject({
    id: "polymarket-900001",
    locationId: "country-bdi",
    locationLabel: "Burundi",
    evidenceStatus: "country-anchor",
    geographyKind: "regional",
    priceChange1h: 0.25,
    marketConditionId: mockConditionId(900_001),
  });
  expect(newCountryPair?.countryCodes).toEqual(
    expect.arrayContaining(["BI", "RW"]),
  );
  expect(newCountryPair?.countryFeatureIds).toEqual(
    expect.arrayContaining(["BDI", "RWA"]),
  );

  const tagFallback = normalizeConflictPreviewEvent(
    event("900002", "Will forces capture Goma before 2027?", [
      { slug: "armed-conflict", label: "Armed Conflict" },
      {
        slug: "democratic-republic-of-the-congo",
        label: "Democratic Republic of the Congo",
      },
    ]),
  );
  expect(tagFallback).toMatchObject({
    locationId: "country-cod",
    countryCodes: expect.arrayContaining(["CD"]),
    countryFeatureIds: expect.arrayContaining(["COD"]),
  });

  const newMajorPair = normalizeConflictPreviewEvent(
    event("900003", "US x Russia military clash before 2027?", [
      { slug: "geopolitics", label: "Geopolitics" },
      { slug: "military-action", label: "Military Action" },
      { slug: "us-iran", label: "Iran" },
    ]),
  );
  expect(newMajorPair).toMatchObject({
    locationId: "country-rus",
    countryCodes: ["RU", "US"],
    countryFeatureIds: ["RUS", "USA"],
  });

  const mixedDeadlineEvent = event(
    "707496",
    "US x Iran Effective Ceasefire by...? (2 week pause)",
    [{ slug: "ceasefire", label: "Ceasefire" }],
  );
  const marketTemplate = mixedDeadlineEvent.markets![0]!;
  const expiredEndDate = new Date(
    Date.now() - 24 * 60 * 60_000,
  ).toISOString();
  const futureEndDate = new Date(
    Date.now() + 30 * 24 * 60 * 60_000,
  ).toISOString();
  mixedDeadlineEvent.markets = [
    {
      ...marketTemplate,
      id: "2937525",
      conditionId: mockConditionId(31),
      question: "US x Iran Effective Ceasefire by July 31?",
      volume: 8_247_216,
      endDate: expiredEndDate,
    },
    {
      ...marketTemplate,
      id: "2937527",
      conditionId: mockConditionId(831),
      question: "US x Iran Effective Ceasefire by August 31?",
      volume: 1_612_575,
      endDate: futureEndDate,
    },
  ];
  expect(normalizeConflictPreviewEvent(mixedDeadlineEvent)).toMatchObject({
    id: "polymarket-707496",
    title: "US x Iran Effective Ceasefire by August 31?",
    endDate: futureEndDate,
    marketConditionId: mockConditionId(831),
  });

  const expiredEvent = event(
    "900004",
    "Will Rwanda launch a military operation in Burundi before 2027?",
    [{ slug: "armed-conflict", label: "Armed Conflict" }],
  );
  expiredEvent.markets![0]!.endDate = "2026-01-01T00:00:00Z";
  expect(normalizeConflictPreviewEvent(expiredEvent)).toBeNull();

  const invalidDateEvent = event(
    "900005",
    "Will Rwanda launch a military operation in Burundi before 2027?",
    [{ slug: "armed-conflict", label: "Armed Conflict" }],
  );
  invalidDateEvent.markets![0]!.endDate = "invalid-upstream-date";
  expect(normalizeConflictPreviewEvent(invalidDateEvent)).toBeNull();
});

test("keeps the antimeridian and world-copy seams hidden", async ({ page }) => {
  const shell = await openReadyMap(page);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect
    .poll(async () => Number(await shell.getAttribute("data-map-zoom")))
    .toBeLessThanOrEqual(1.72);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(artifactRoot, "map-seam-check-1672x941.png"),
    animations: "disabled",
  });
});

test("keeps the map usable across approval viewports", async ({ page }) => {
  // This one test performs five complete software-WebGL initializations.
  // Keep the global per-test budget strict and widen only this viewport matrix.
  test.setTimeout(180_000);
  const viewports = [
    { width: 1440, height: 900, file: "map-check-1440x900.png" },
    { width: 1920, height: 1080, file: "map-check-1920x1080.png" },
    { width: 844, height: 390, file: "map-check-844x390.png" },
    { width: 390, height: 844, file: "map-check-390x844.png" },
    { width: 390, height: 664, file: "map-check-390x664.png" },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openReadyMap(page);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    const [shellBox, stageBox, controlsBox] = await Promise.all([
      page.locator('[data-map-ready="true"]').boundingBox(),
      page
        .getByRole("region", {
          name: /Interactive map of global conflict/,
        })
        .boundingBox(),
      page.getByLabel("Map controls").boundingBox(),
    ]);
    const rail = page.getByRole("complementary", {
      name: "Live market activity",
    });
    const railBox = (await rail.count()) > 0 ? await rail.boundingBox() : null;
    expect(shellBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    if (shellBox && stageBox && controlsBox) {
      const stageBottom = stageBox.y + stageBox.height;
      expect(Math.abs(shellBox.height - viewport.height)).toBeLessThanOrEqual(1);
      expect(stageBottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(controlsBox.y).toBeGreaterThanOrEqual(stageBox.y);
      expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(
        stageBottom + 1,
      );
    }
    if (stageBox && railBox) {
      const stageBottom = stageBox.y + stageBox.height;
      expect(railBox.y).toBeGreaterThanOrEqual(stageBox.y);
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(stageBottom + 1);
    }
    if (viewport.width === 390) {
      await page
        .locator('[data-market-event-id="middle-east-escalation"]')
        .evaluate((button: HTMLButtonElement) => button.click());
      const popupBox = await page.getByTestId("conflict-popup").boundingBox();
      const controlsBox = await page.getByLabel("Map controls").boundingBox();
      const stripBox = await page
        .locator('[data-market-strip="true"]')
        .boundingBox();
      expect(popupBox).not.toBeNull();
      expect(controlsBox).not.toBeNull();
      expect(stripBox).not.toBeNull();
      if (popupBox && controlsBox && stripBox) {
        expect(popupBox.x).toBeGreaterThanOrEqual(10);
        expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(
          viewport.width - 10,
        );
        expect(popupBox.width).toBeGreaterThanOrEqual(340);
        expect(stripBox.y).toBe(0);
        expect(stripBox.height).toBe(36);
        expect(popupBox.y).toBeGreaterThanOrEqual(stripBox.height + 10);
        expect(popupBox.y + popupBox.height).toBeLessThan(controlsBox.y);
      }
      await page
        .getByTestId("conflict-popup")
        .getByRole("button", { name: /Close .* market popup/ })
        .click();
      await expect(page.getByTestId("conflict-popup")).toHaveCount(0);
    }
    await page.screenshot({
      path: path.join(artifactRoot, viewport.file),
      animations: "disabled",
    });
  }
});
