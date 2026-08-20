import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { chromium } from "@playwright/test";

const DEFAULT_URL = "http://127.0.0.1:3100/";
const DEFAULT_VIEWPORT = { width: 1917, height: 779 };

const profiles = {
  native: {
    cpuThrottle: 1,
    network: null,
  },
  constrained: {
    cpuThrottle: 4,
    network: null,
  },
  slow4g: {
    cpuThrottle: 4,
    network: {
      offline: false,
      latency: 150,
      downloadThroughput: 209_715,
      uploadThroughput: 98_304,
      connectionType: "cellular4g",
    },
  },
};

function readOption(name, fallback = null) {
  const prefix = `--${name}=`;
  const option = process.argv.find((argument) => argument.startsWith(prefix));
  return option ? option.slice(prefix.length) : fallback;
}

function percentile(values, percentage) {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function summarizeFrames(frameTimestamps, durationMs) {
  const intervals = frameTimestamps
    .slice(1)
    .map((timestamp, index) => timestamp - frameTimestamps[index]);
  const renderedDuration =
    frameTimestamps.length > 1
      ? frameTimestamps.at(-1) - frameTimestamps[0]
      : durationMs;
  return {
    durationMs: Math.round(durationMs),
    frameCount: frameTimestamps.length,
    fps:
      renderedDuration > 0
        ? round(((frameTimestamps.length - 1) * 1_000) / renderedDuration, 1)
        : 0,
    medianFrameMs: round(percentile(intervals, 50), 1),
    p95FrameMs: round(percentile(intervals, 95), 1),
    worstFrameMs: round(Math.max(0, ...intervals), 1),
    framesOver32ms: intervals.filter((interval) => interval > 32).length,
    framesOver50ms: intervals.filter((interval) => interval > 50).length,
  };
}

function summarizeLongTasks(longTasks) {
  return {
    count: longTasks.length,
    totalDurationMs: round(
      longTasks.reduce((total, task) => total + task.duration, 0),
      1,
    ),
    worstDurationMs: round(
      Math.max(0, ...longTasks.map((task) => task.duration)),
      1,
    ),
  };
}

function readMetric(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? 0;
}

function networkCategory(url, mimeType, resourceType, origin) {
  if (url.includes("tiles.openfreemap.org")) return "vectorTiles";
  if (url.startsWith(`${origin}/maps/night-earth/`)) return "rasterTiles";
  if (url.startsWith(`${origin}/api/`)) return "api";
  if (resourceType === "Script" || mimeType.includes("javascript")) return "js";
  if (resourceType === "Stylesheet" || mimeType.includes("css")) return "css";
  if (resourceType === "Font" || mimeType.includes("font")) return "font";
  if (resourceType === "Image" || mimeType.startsWith("image/")) return "image";
  if (resourceType === "Document") return "document";
  return "other";
}

function summarizeNetwork(requests, origin) {
  const categories = {};
  let encodedBytes = 0;
  for (const request of requests.values()) {
    const category = networkCategory(
      request.url,
      request.mimeType,
      request.resourceType,
      origin,
    );
    const current = categories[category] ?? { requests: 0, encodedBytes: 0 };
    current.requests += 1;
    current.encodedBytes += request.encodedDataLength;
    categories[category] = current;
    encodedBytes += request.encodedDataLength;
  }
  return {
    requests: requests.size,
    encodedBytes,
    encodedKilobytes: round(encodedBytes / 1_024, 1),
    categories: Object.fromEntries(
      Object.entries(categories)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, value]) => [
          category,
          {
            requests: value.requests,
            encodedKilobytes: round(value.encodedBytes / 1_024, 1),
          },
        ]),
    ),
  };
}

async function startInteractionCapture(page) {
  await page.evaluate(() => {
    window.__oddsfrontPerfFrames = [];
    window.__oddsfrontPerfLongTasks = [];
    window.__oddsfrontPerfCapturing = true;
    const captureFrame = (timestamp) => {
      if (!window.__oddsfrontPerfCapturing) return;
      window.__oddsfrontPerfFrames.push(timestamp);
      window.requestAnimationFrame(captureFrame);
    };
    window.requestAnimationFrame(captureFrame);
  });
}

async function stopInteractionCapture(page, durationMs) {
  const capture = await page.evaluate(() => {
    window.__oddsfrontPerfCapturing = false;
    return {
      frames: window.__oddsfrontPerfFrames ?? [],
      longTasks: window.__oddsfrontPerfLongTasks ?? [],
    };
  });
  return {
    ...summarizeFrames(capture.frames, durationMs),
    longTasks: summarizeLongTasks(capture.longTasks),
  };
}

async function runDragBenchmark(page, cdp, interactionSteps) {
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no bounding box.");
  const startX = box.x + box.width * 0.47;
  const startY = box.y + box.height * 0.57;
  const beforeMetrics = await cdp.send("Performance.getMetrics");
  await startInteractionCapture(page);
  const startedAt = Date.now();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= interactionSteps; step += 1) {
    const progress = step / interactionSteps;
    await page.mouse.move(
      startX + 340 * progress,
      startY - 74 * Math.sin(progress * Math.PI),
    );
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await page.mouse.up();
  await page.waitForTimeout(450);
  const durationMs = Date.now() - startedAt;
  const capture = await stopInteractionCapture(page, durationMs);
  const afterMetrics = await cdp.send("Performance.getMetrics");
  return {
    ...capture,
    mainThreadTaskMs: round(
      (readMetric(afterMetrics.metrics, "TaskDuration") -
        readMetric(beforeMetrics.metrics, "TaskDuration")) *
        1_000,
      1,
    ),
  };
}

async function runZoomBenchmark(page, cdp) {
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no bounding box.");
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  const beforeMetrics = await cdp.send("Performance.getMetrics");
  await startInteractionCapture(page);
  const startedAt = Date.now();
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(700);
  const durationMs = Date.now() - startedAt;
  const capture = await stopInteractionCapture(page, durationMs);
  const afterMetrics = await cdp.send("Performance.getMetrics");
  return {
    ...capture,
    mainThreadTaskMs: round(
      (readMetric(afterMetrics.metrics, "TaskDuration") -
        readMetric(beforeMetrics.metrics, "TaskDuration")) *
        1_000,
      1,
    ),
  };
}

async function runOnce(
  browser,
  targetUrl,
  profileName,
  runNumber,
  interactionSteps,
  experiment,
  deviceHints,
) {
  const profile = profiles[profileName];
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  });
  await context.addInitScript(({ hardwareConcurrency, deviceMemory }) => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => hardwareConcurrency,
    });
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      get: () => deviceMemory,
    });
    window.__oddsfrontPerfLongTasks = [];
    if (typeof PerformanceObserver !== "undefined") {
      try {
        const observer = new PerformanceObserver((list) => {
          const target = window.__oddsfrontPerfLongTasks;
          if (!Array.isArray(target)) return;
          for (const entry of list.getEntries()) {
            target.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Long Task API is optional; frame and CDP metrics remain available.
      }
    }
  }, deviceHints);

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Performance.enable");
  if (profile.cpuThrottle > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: profile.cpuThrottle,
    });
  }
  if (profile.network) {
    await cdp.send("Network.emulateNetworkConditions", profile.network);
  }

  const requests = new Map();
  cdp.on("Network.responseReceived", (event) => {
    if (event.response.url.startsWith("data:")) return;
    requests.set(event.requestId, {
      url: event.response.url,
      mimeType: event.response.mimeType ?? "",
      resourceType: event.type ?? "Other",
      encodedDataLength: event.response.encodedDataLength ?? 0,
    });
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.encodedDataLength = event.encodedDataLength ?? 0;
  });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const url = new URL(targetUrl);
  url.searchParams.set("map_perf_run", String(runNumber));
  url.searchParams.set("map_perf_profile", profileName);
  const startedAt = Date.now();
  const response = await page.goto(url.href, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  const domContentLoadedMs = Date.now() - startedAt;
  await page.waitForSelector("canvas.maplibregl-canvas", {
    state: "visible",
    timeout: 120_000,
  });
  const canvasVisibleMs = Date.now() - startedAt;
  await page.waitForSelector('[data-map-ready="true"]', {
    state: "attached",
    timeout: 120_000,
  });
  const mapReadyMs = Date.now() - startedAt;
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("a")).some((link) =>
        /Market/.test(link.textContent || ""),
      ),
    null,
    { timeout: 60_000 },
  );
  const alertsVisibleMs = Date.now() - startedAt;
  await page.waitForTimeout(800);

  const pageState = await page.evaluate(() => {
    const shell = document.querySelector("[data-map-ready]");
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const canvasBox = canvas?.getBoundingClientRect();
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      eventCount: Number(shell?.getAttribute("data-event-count") ?? 0),
      markerCount: Number(
        shell?.getAttribute("data-visible-marker-count") ?? 0,
      ),
      domMarkerCount: document.querySelectorAll("[data-marker-strength]").length,
      feedMode: shell?.getAttribute("data-feed-mode") ?? "unknown",
      detailedMapTextMatches: (document.body.innerText.match(/Detailed map/g) ?? [])
        .length,
      canvasBox: canvasBox
        ? {
            x: Math.round(canvasBox.x),
            y: Math.round(canvasBox.y),
            width: Math.round(canvasBox.width),
            height: Math.round(canvasBox.height),
          }
        : null,
      canvasBackingSize: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
          }
        : null,
      mapPixelRatio: Number(
        shell?.getAttribute("data-map-pixel-ratio") ?? 0,
      ),
      mapRenderQuality:
        shell?.getAttribute("data-map-render-quality") ?? "unknown",
      horizontalOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      navigation: navigation
        ? {
            responseEndMs: Math.round(navigation.responseEnd),
            domContentLoadedMs: Math.round(
              navigation.domContentLoadedEventEnd,
            ),
            loadEventMs: Math.round(navigation.loadEventEnd),
          }
        : null,
    };
  });

  if (experiment === "detach-dom-markers") {
    await page.evaluate(() => {
      for (const marker of document.querySelectorAll("[data-marker-strength]")) {
        marker.remove();
      }
    });
  }

  const drag = await runDragBenchmark(page, cdp, interactionSteps);
  await page.waitForTimeout(400);
  const zoom = await runZoomBenchmark(page, cdp);
  const network = summarizeNetwork(requests, url.origin);
  const result = {
    run: runNumber,
    httpStatus: response?.status() ?? null,
    load: {
      domContentLoadedMs,
      canvasVisibleMs,
      mapReadyMs,
      alertsVisibleMs,
    },
    page: pageState,
    drag,
    zoom,
    network,
    errors: {
      console: consoleErrors,
      page: pageErrors,
    },
  };
  await context.close();
  return result;
}

function median(values) {
  return percentile(values, 50);
}

function aggregate(runs) {
  return {
    load: {
      mapReadyMs: Math.round(median(runs.map((run) => run.load.mapReadyMs))),
      alertsVisibleMs: Math.round(
        median(runs.map((run) => run.load.alertsVisibleMs)),
      ),
    },
    drag: {
      fps: round(median(runs.map((run) => run.drag.fps)), 1),
      p95FrameMs: round(median(runs.map((run) => run.drag.p95FrameMs)), 1),
      mainThreadTaskMs: round(
        median(runs.map((run) => run.drag.mainThreadTaskMs)),
        1,
      ),
    },
    zoom: {
      fps: round(median(runs.map((run) => run.zoom.fps)), 1),
      p95FrameMs: round(median(runs.map((run) => run.zoom.p95FrameMs)), 1),
      mainThreadTaskMs: round(
        median(runs.map((run) => run.zoom.mainThreadTaskMs)),
        1,
      ),
    },
    network: {
      requests: Math.round(median(runs.map((run) => run.network.requests))),
      encodedKilobytes: round(
        median(runs.map((run) => run.network.encodedKilobytes)),
        1,
      ),
    },
  };
}

async function main() {
  const targetUrl = readOption("url", process.env.MAP_BENCHMARK_URL ?? DEFAULT_URL);
  const profileName = readOption(
    "profile",
    process.env.MAP_BENCHMARK_PROFILE ?? "constrained",
  );
  if (!(profileName in profiles)) {
    throw new Error(
      `Unknown profile ${profileName}. Expected one of ${Object.keys(profiles).join(", ")}.`,
    );
  }
  const requestedRuns = Number(readOption("runs", "3"));
  const runCount = Number.isInteger(requestedRuns)
    ? Math.min(10, Math.max(1, requestedRuns))
    : 3;
  const outputPath = readOption("output", null);
  const requestedInteractionSteps = Number(readOption("interaction-steps", "12"));
  const interactionSteps = Number.isInteger(requestedInteractionSteps)
    ? Math.min(96, Math.max(6, requestedInteractionSteps))
    : 12;
  const experiment = readOption("experiment", "none");
  if (!["none", "detach-dom-markers"].includes(experiment)) {
    throw new Error(
      `Unknown experiment ${experiment}. Expected none or detach-dom-markers.`,
    );
  }
  const requestedHardwareConcurrency = Number(
    readOption("hardware-concurrency", "4"),
  );
  const requestedDeviceMemory = Number(readOption("device-memory", "4"));
  const deviceHints = {
    hardwareConcurrency: Number.isFinite(requestedHardwareConcurrency)
      ? Math.min(64, Math.max(1, requestedHardwareConcurrency))
      : 4,
    deviceMemory: Number.isFinite(requestedDeviceMemory)
      ? Math.min(64, Math.max(1, requestedDeviceMemory))
      : 4,
  };
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    args: ["--disable-dev-shm-usage"],
  });
  const runs = [];
  try {
    for (let runNumber = 1; runNumber <= runCount; runNumber += 1) {
      runs.push(
        await runOnce(
          browser,
          targetUrl,
          profileName,
          runNumber,
          interactionSteps,
          experiment,
          deviceHints,
        ),
      );
    }
  } finally {
    await browser.close();
  }
  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    profile: profileName,
    experiment,
    interactionSteps,
    deviceHints,
    viewport: DEFAULT_VIEWPORT,
    runs,
    median: aggregate(runs),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error("OddsFront map performance benchmark failed.", error);
  process.exitCode = 1;
});
