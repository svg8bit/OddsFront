import { expect, test } from "@playwright/test";
import { socialPublicationDue, SOCIAL_PUBLICATION_INTERVAL_MS } from "../lib/news/social-publication";

test("social publishers wait five elapsed hours across clock and date boundaries", () => {
  const last = Date.parse("2026-09-12T21:05:26Z");
  expect(SOCIAL_PUBLICATION_INTERVAL_MS).toBe(18_000_000);
  expect(socialPublicationDue(last, Date.parse("2026-09-13T02:05:25.999Z"))).toBe(false);
  expect(socialPublicationDue(last, Date.parse("2026-09-13T02:05:26Z"))).toBe(true);
  expect(socialPublicationDue(last, Date.parse("2026-09-13T03:00:00Z"))).toBe(true);
  expect(socialPublicationDue(last, last + 3_600_000)).toBe(false);
  expect(socialPublicationDue(last, last - 1)).toBe(false);
  expect(socialPublicationDue(Number.NaN, last)).toBe(false);
  expect(socialPublicationDue(0, last)).toBe(true);
});
