import { createHash } from "node:crypto";

export function russianEditorialKey(text: string): string {
  return createHash("sha256").update(`m2m100-v1:ru:${text}`).digest("hex");
}

export function validateRussianEditorialTranslation(source: string, translated: unknown): string {
  if (typeof translated !== "string" || !/[А-Яа-яЁё]/.test(translated) || translated.length > Math.max(500, source.length * 4)) throw new Error("Russian editorial translation is missing or invalid");
  // Probabilities are never generated. Preserve every numeral in the question
  // or headline, including dates and counts, exactly as supplied by the source.
  const numbers = (value: string) => (value.match(/\d+/g) ?? []).sort().join(",");
  if (numbers(source) !== numbers(translated)) throw new Error("Russian editorial translation changed source numbers");
  return translated.trim();
}
