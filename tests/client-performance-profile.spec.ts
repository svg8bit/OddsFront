import { expect, test } from "@playwright/test";

import {
  selectMapExperience,
  type ClientPerformanceCapabilities,
} from "../lib/client-performance-profile";

const capableDesktop: ClientPerformanceCapabilities = {
  viewportWidth: 1_440,
  coarsePointer: false,
  saveData: false,
  effectiveType: "4g",
  deviceMemory: 8,
  hardwareConcurrency: 8,
  forcedExperience: null,
};

test("uses the detailed map on capable desktop devices", () => {
  expect(selectMapExperience(capableDesktop)).toBe("full");
});

test("uses Lite mode for compact, constrained, or data-saving devices", () => {
  const constrainedProfiles: ClientPerformanceCapabilities[] = [
    { ...capableDesktop, viewportWidth: 390 },
    { ...capableDesktop, coarsePointer: true },
    { ...capableDesktop, saveData: true },
    { ...capableDesktop, effectiveType: "2g" },
    { ...capableDesktop, effectiveType: "3g" },
    { ...capableDesktop, deviceMemory: 2 },
    { ...capableDesktop, hardwareConcurrency: 2 },
    {
      ...capableDesktop,
      deviceMemory: 4,
      hardwareConcurrency: 4,
    },
  ];

  for (const profile of constrainedProfiles) {
    expect(selectMapExperience(profile)).toBe("lite");
  }
});

test("honors an explicit map experience override", () => {
  expect(
    selectMapExperience({
      ...capableDesktop,
      viewportWidth: 390,
      forcedExperience: "full",
    }),
  ).toBe("full");
  expect(
    selectMapExperience({
      ...capableDesktop,
      forcedExperience: "lite",
    }),
  ).toBe("lite");
});
