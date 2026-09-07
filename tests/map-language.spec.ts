import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

for (const viewport of [{ width: 1510, height: 941 }, { width: 390, height: 844 }]) {
  test(`language switching preserves rendered event points and camera at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("https://tiles.openfreemap.org/**", route => route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) }));
    await page.goto("/global-conflict-map-preview?fixture=1");
    const shell = page.locator('main[data-map-ready="true"]');
    await expect(shell).toBeVisible();
    const camera = await shell.evaluate(element => ["longitude", "latitude", "zoom"].map(key => element.getAttribute(`data-map-${key}`)));
    const brightPixels = async () => {
      const png = PNG.sync.read(await page.locator(".maplibregl-canvas").screenshot());
      let count = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i]! > 135 && png.data[i + 2]! > 140 && png.data[i + 1]! < 125) count += 1;
      }
      return count;
    };
    await expect.poll(brightPixels).toBeGreaterThan(10);
    for (const locale of ["ru", "fa", "en"]) {
      const menu = page.getByRole("combobox");
      if (!await menu.isVisible()) await page.getByRole("button", { name: "Language", exact: true }).click();
      await menu.selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect.poll(brightPixels).toBeGreaterThan(10);
      expect(await shell.evaluate(element => ["longitude", "latitude", "zoom"].map(key => element.getAttribute(`data-map-${key}`)))).toEqual(camera);
    }
    await page.keyboard.press("Escape");
    const markerId = await page.locator("[data-market-event-id]").evaluateAll(elements => elements.find(element => {
      const box = element.getBoundingClientRect();
      return box.left > 5 && box.right < innerWidth - 5 && box.top > 50 && box.bottom < innerHeight - 180;
    })?.getAttribute("data-market-event-id"));
    expect(markerId).toBeTruthy();
    await page.locator(`[data-market-event-id="${markerId}"]`).click();
    await expect(page.getByTestId("conflict-popup")).toBeVisible();
  });
}
