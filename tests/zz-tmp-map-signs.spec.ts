import { expect, test } from "@playwright/test";
import { signRowOffsets, SIGN_SIZE } from "../features/global-conflict-map/preview/sign-layout";
import { markerKindFor } from "../lib/polymarket-conflict-preview";

test("geopolitical markets get their own sign kind; conflict markets keep the dot", () => {
  expect(markerKindFor("Will the U.S. invade Iran before 2027?", "")).toBe("conflict");
  expect(markerKindFor("Putin out as President of Russia by December 31, 2026?", "")).toBe("politics");
  expect(markerKindFor("Will Trump meet with Vladimir Putin in 2026?", "")).toBe("diplomacy");
  expect(markerKindFor("Will the US acquire part of Greenland in 2026?", "")).toBe("territory");
  expect(markerKindFor("Bab el-Mandeb Strait effectively closed by December 31?", "")).toBe("transit");
});

test("signs form a fixed centred row under the place's name, or under its dot", () => {
  expect(signRowOffsets(1)).toEqual([[0, 18]]);
  expect(signRowOffsets(3)).toEqual([[-(SIGN_SIZE + 4), 18], [0, 18], [SIGN_SIZE + 4, 18]]);
  const underDot = signRowOffsets(2, 12);
  expect(underDot.every(([, y]) => y === 25)).toBe(true);
  expect(underDot[1]![0] - underDot[0]![0]).toBe(SIGN_SIZE + 4);
});
