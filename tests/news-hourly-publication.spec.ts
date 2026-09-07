import { expect, test } from "@playwright/test";
import { hourlyPublicationDue } from "../lib/news/hourly-publication";

test("hourly posts use clock hours without accumulating editor and timer delay", () => {
  const last = Date.parse("2026-09-07T21:05:26Z");
  expect(hourlyPublicationDue(last, Date.parse("2026-09-07T21:59:59Z"))).toBe(false);
  expect(hourlyPublicationDue(last, Date.parse("2026-09-07T22:00:00Z"))).toBe(true);
  expect(hourlyPublicationDue(Date.parse("2026-09-07T22:03:12Z"), Date.parse("2026-09-07T22:55:00Z"))).toBe(false);
  expect(hourlyPublicationDue(last, Date.parse("2026-09-08T00:00:00Z"))).toBe(true);
  expect(hourlyPublicationDue(last, last - 1)).toBe(false);
  expect(hourlyPublicationDue(Number.NaN, last)).toBe(false);
  expect(hourlyPublicationDue(0, last)).toBe(true);
});
