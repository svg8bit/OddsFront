import { expect, test } from "@playwright/test";
import { placeSigns, signVisible, zoomTier } from "../features/global-conflict-map/preview/sign-layout";
import { markerKindFor } from "../lib/polymarket-conflict-preview";

test("geopolitical markets get their own sign kind; conflict markets keep the dot", () => {
  expect(markerKindFor("Will the U.S. invade Iran before 2027?", "")).toBe("conflict");
  expect(markerKindFor("Putin out as President of Russia by December 31, 2026?", "")).toBe("politics");
  expect(markerKindFor("Will Trump meet with Vladimir Putin in 2026?", "")).toBe("diplomacy");
  expect(markerKindFor("Will the US acquire part of Greenland in 2026?", "")).toBe("territory");
  expect(markerKindFor("Bab el-Mandeb Strait effectively closed by December 31?", "")).toBe("transit");
});

test("signs sit beside their dot, never on it or on each other, and smaller markets wait for zoom", () => {
  const dots = [{ x: 400, y: 300, radius: 12 }, { x: 430, y: 300, radius: 9 }];
  const signs = [
    { id: "putin", x: 400, y: 300, size: 17, weight: 30e6, dotRadius: 12 },
    { id: "meet", x: 400, y: 300, size: 17, weight: 2e6, dotRadius: 12 },
    { id: "alone", x: 700, y: 500, size: 17, weight: 1e6, dotRadius: 0 },
  ];
  const offsets = placeSigns(signs, dots);
  const at = (id: string) => { const sign = signs.find(item => item.id === id)!; const [dx, dy] = offsets.get(id)!; return { x: sign.x + dx, y: sign.y + dy }; };
  for (const id of ["putin", "meet"]) for (const dot of dots) expect(Math.hypot(at(id).x - dot.x, at(id).y - dot.y)).toBeGreaterThanOrEqual(dot.radius + 8.5);
  expect(Math.hypot(at("putin").x - at("meet").x, at("putin").y - at("meet").y)).toBeGreaterThanOrEqual(17);
  expect(offsets.get("alone")).toEqual([0, 0]);
  expect([zoomTier(1.7), zoomTier(3), zoomTier(5)]).toEqual(["far", "mid", "near"]);
  expect([signVisible(2e6, "far"), signVisible(400e3, "far"), signVisible(400e3, "mid"), signVisible(30e3, "near")]).toEqual([true, false, true, true]);
});
