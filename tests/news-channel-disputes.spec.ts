import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";

test("channel moderation recognizes only recent exact disputed-resolution alerts in authorized channels", () => {
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_channel_disputes.py"], { encoding: "utf8", timeout: 10_000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
