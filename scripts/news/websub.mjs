import { LOCALES } from "../../lib/news/types.ts";
import { newsPath } from "../../lib/news/routing.ts";

const origin = "https://oddsfront.com";
const hub = "https://pubsubhubbub.appspot.com/";
const body = new URLSearchParams({ "hub.mode": "publish" });
for (const locale of LOCALES) body.append("hub.url", `${origin}${newsPath(locale, "/rss.xml")}`);
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  console.log(JSON.stringify({ service: "WebSub", dryRun: true, hub, feeds: LOCALES.length }));
} else {
  try {
    const response = await fetch(hub, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "OddsFrontWebSub/1.0",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const accepted = response.ok;
    console.log(JSON.stringify({ service: "WebSub", status: response.status, feeds: LOCALES.length, accepted }));
    if (!accepted) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ service: "WebSub", accepted: false, error: error instanceof Error ? error.message : "Unknown error" }));
    process.exitCode = 1;
  }
}
