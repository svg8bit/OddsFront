import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`keeps the ${mobile ? "mobile" : "desktop"} card visible while switching points`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1672, height: 941 },
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 3 : 1,
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const detailRequests: string[] = [];
      page.on("request", request => {
        if (request.url().includes("tiles.openfreemap.org/planet/")) detailRequests.push(request.url());
      });
      await page.goto("http://127.0.0.1:3100/global-conflict-map-preview?fixture=1");
      const shell = page.locator("main[data-map-ready]");
      await expect(shell).toHaveAttribute("data-map-ready", "true");
      const camera = await shell.getAttribute("data-engine-camera");
      const first = page.locator('[data-market-event-id="ukraine-ceasefire"]');
      if (mobile) await first.tap(); else await first.click();
      const popup = page.getByTestId("conflict-popup");
      await expect(popup).toBeVisible();
      await expect(popup).toHaveCSS("opacity", "1");
      await popup.evaluate(element => { element.dataset.continuity = "same-card"; });
      const framesPromise = page.evaluate(() => new Promise<Array<{ visible: boolean; inBounds: boolean }>>(resolve => {
        const frames: Array<{ visible: boolean; inBounds: boolean }> = [];
        const start = performance.now();
        const record = () => {
          const popup = document.querySelector('[data-testid="conflict-popup"]');
          const rect = popup?.getBoundingClientRect();
          frames.push({
            visible: !!popup && getComputedStyle(popup).visibility === "visible" && getComputedStyle(popup).opacity !== "0",
            inBounds: !!rect && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          });
          if (performance.now() - start < 700) requestAnimationFrame(record);
          else resolve(frames);
        };
        requestAnimationFrame(record);
      }));
      const secondId = mobile ? "horn-africa-peace" : "south-america-venezuela";
      const second = page.locator(`[data-market-event-id="${secondId}"]`);
      if (mobile) await second.tap(); else await second.click();
      await expect(shell).toHaveAttribute("data-selected-event", secondId);
      await expect(popup).toHaveAttribute("data-continuity", "same-card");
      const frames = await framesPromise;
      expect(frames.length).toBeGreaterThan(5);
      expect(frames.every(frame => frame.visible && frame.inBounds)).toBe(true);
      await expect(shell).toHaveAttribute("data-engine-camera", camera!);
      await expect(page.locator("canvas")).toHaveCount(1);
      expect(detailRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
