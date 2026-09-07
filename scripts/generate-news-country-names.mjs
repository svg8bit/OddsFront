// Commit a stable ICU snapshot: server/browser CLDR versions can disagree (for example PS).
import { writeFile } from "node:fs/promises";
const locales = ["en", "zh", "ko", "vi", "de", "es", "pt-BR", "fr", "ru", "uk", "fa", "he"];
const english = new Intl.DisplayNames(["en"], { type: "region" });
const codes = [];
for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
  const code = String.fromCharCode(first, second);
  if (english.of(code) !== code) codes.push(code);
}
const names = Object.fromEntries(locales.map(locale => {
  const display = new Intl.DisplayNames([locale], { type: "region" });
  return [locale, Object.fromEntries(codes.map(code => [code, display.of(code)]))];
}));
await writeFile(new URL("../lib/news/country-names.json", import.meta.url), `${JSON.stringify(names)}\n`);
