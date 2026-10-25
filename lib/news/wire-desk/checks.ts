// Deterministic gates for wire-desk articles: originality against the source
// texts, numbers that must come from the sources or the live market, the
// owner's editorial rules in both languages, and structure.
import { violatesCasualtyPolicy } from "../validation.ts";
import { foreignElectionMarket } from "../hot-desk/markets.ts";
import type { ArticleBlock } from "../types.ts";

export type ArticleCopy = { title: string; description: string; body: ArticleBlock[] };

const words = (text: string) => text.toLowerCase().normalize("NFKC").replace(/[’']/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Text outside quotation marks: direct quotes are allowed to match their source. */
export function withoutQuotes(text: string) {
  return text.replace(/“[^”]{0,400}”|"[^"]{0,400}"|«[^»]{0,400}»/g, " ");
}

export type OverlapReport = { ratio: number; longestRun: number; phrases: string[] };

/**
 * Share of the article's 8-word sequences (outside quotes) that also occur in a
 * source, the longest copied run in words, and the copied phrases for feedback.
 */
export function sourceOverlap(articleText: string, sourceTexts: readonly string[], size = 8): OverlapReport {
  const article = words(withoutQuotes(articleText));
  const shingles = new Set<string>();
  for (const source of sourceTexts) {
    const tokens = words(source);
    for (let index = 0; index + size <= tokens.length; index += 1) shingles.add(tokens.slice(index, index + size).join(" "));
  }
  let shared = 0; let run = 0; let longestRun = 0; let total = 0;
  const phrases: string[] = [];
  let start = -1;
  for (let index = 0; index + size <= article.length; index += 1) {
    total += 1;
    if (shingles.has(article.slice(index, index + size).join(" "))) {
      shared += 1;
      if (run === 0) start = index;
      run += 1;
      longestRun = Math.max(longestRun, run + size - 1);
    } else {
      if (run > 0 && phrases.length < 8) phrases.push(article.slice(start, start + run + size - 1).join(" "));
      run = 0;
    }
  }
  if (run > 0 && phrases.length < 8) phrases.push(article.slice(start, start + run + size - 1).join(" "));
  return { ratio: total ? shared / total : 0, longestRun, phrases };
}

/** Numbers as written ("1,300", "4.5", "1 200", "4,5" in Russian), normalized to plain digits. */
export function numbersIn(text: string, locale: "en" | "ru" = "en"): string[] {
  const found: string[] = [];
  const pattern = locale === "ru" ? /\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g : /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  for (const match of text.matchAll(pattern)) {
    let value = match[0];
    value = locale === "ru" ? value.replace(/[  ]/g, "").replace(",", ".") : value.replace(/,/g, "");
    found.push(value.replace(/\.0+$/, "").replace(/^0+(?=\d)/, ""));
  }
  return found;
}

const MONTHS = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i;

/** Numbers of the article that appear in no source, no market brief and are no plain date or small count. */
export function unsupportedNumbers(text: string, allowed: ReadonlySet<string>, locale: "en" | "ru" = "en") {
  const datePositions = new Set<string>();
  const datePattern = new RegExp(`(?:${MONTHS.source})\\s+(\\d{1,2})\\b|\\b(\\d{1,2})\\s+(?:${MONTHS.source})`, "gi");
  for (const match of text.matchAll(datePattern)) datePositions.add(match[1] ?? match[2] ?? "");
  return [...new Set(numbersIn(text, locale))].filter(value => {
    const number = Number(value);
    if (allowed.has(value)) return false;
    if (Number.isInteger(number) && number <= 10) return false;
    if (Number.isInteger(number) && number >= 1990 && number <= 2100) return false;
    if (datePositions.has(value)) return false;
    return true;
  });
}

export function allowedNumbers(texts: readonly string[]) {
  const allowed = new Set<string>();
  for (const text of texts) for (const value of numbersIn(text, /[А-Яа-яЁё]/.test(text) ? "ru" : "en")) allowed.add(value);
  return allowed;
}

const RU_CASUALTY = /погиб|убит|убийств|жертв|смерт|скончал|расстрел|резн|число погибших|раненых и убитых/i;
const GEO_TOPIC = /geo-?block|geo-?restrict|region(?:al)?\s+(?:block|restriction)|vpn\b|геоблок|блокировк[аи] по регион|ограничени[яе] доступа по регион/i;
const PROMO = /guaranteed profit|bet now|place (?:a|your) bet|must-watch|game-changing|dive into|ставьте сейчас|гарантированн/i;
const PERCENT_POINTS = /\b(?:pp|p\.p\.|percentage points?)\b|п\.\s?п\.|процентн(?:ых|ые|ого) пункт/i;
const CYRILLIC = /[А-Яа-яЁё]/g;
const LATIN = /[A-Za-z]/g;

const joined = (copy: ArticleCopy) => copy.body.map(block => block.text).join("\n\n");
const wordCount = (text: string) => words(text).length;

/** Structural and editorial problems of the English and Russian copy; empty when publishable. */
export function copyProblems(en: ArticleCopy, ru: ArticleCopy): string[] {
  const problems: string[] = [];
  for (const [label, copy] of [["en", en], ["ru", ru]] as const) {
    if (!copy || typeof copy.title !== "string" || typeof copy.description !== "string" || !Array.isArray(copy.body)) { problems.push(`${label}: invalid structure`); continue; }
    if (copy.title.length < 25 || copy.title.length > (label === "ru" ? 130 : 115)) problems.push(`${label}: headline must be 25–${label === "ru" ? 130 : 115} characters (has ${copy.title.length})`);
    if (copy.description.length < 80 || copy.description.length > 320) problems.push(`${label}: description must be 80–320 characters (has ${copy.description.length})`);
    if (copy.body.some(block => !block || !["paragraph", "heading"].includes(block.type) || typeof block.text !== "string" || !block.text.trim())) problems.push(`${label}: invalid body blocks`);
    if (copy.body.some(block => /<[^>]+>|\]\(|https?:\/\/|\*\*|^#+\s/m.test(block?.text ?? ""))) problems.push(`${label}: markup or links in the body`);
    if (/[!?]$/.test(copy.title.trim())) problems.push(`${label}: headline ends with ! or ?`);
    if (PROMO.test(`${copy.title} ${copy.description} ${joined(copy)}`)) problems.push(`${label}: promotional language`);
    if (GEO_TOPIC.test(`${copy.title} ${copy.description} ${joined(copy)}`)) problems.push(`${label}: mentions geoblocking or regional restrictions`);
    if (PERCENT_POINTS.test(joined(copy))) problems.push(`${label}: odds moves must be written as percent levels, never points`);
  }
  if (problems.some(problem => problem.endsWith("invalid structure"))) return problems;
  const paragraphs = en.body.filter(block => block.type === "paragraph" && block.text.length >= 80).length;
  const enWords = wordCount(joined(en));
  if (paragraphs < 5 || enWords < 380) problems.push(`en: article too thin (${enWords} words, ${paragraphs} full paragraphs; need at least 380 words and 5 paragraphs)`);
  if (enWords > 1_100) problems.push(`en: article too long (${enWords} words; at most 1,100)`);
  const ruParagraphs = ru.body.filter(block => block.type === "paragraph").length;
  if (Math.abs(ruParagraphs - en.body.filter(block => block.type === "paragraph").length) > 2) problems.push("ru: the Russian version must carry the same paragraphs as the English one");
  const ruText = `${ru.title} ${ru.description} ${joined(ru)}`;
  const cyrillic = ruText.match(CYRILLIC)?.length ?? 0;
  const latin = ruText.match(LATIN)?.length ?? 0;
  if (cyrillic < 0.85 * (cyrillic + latin)) problems.push("ru: the Russian version must be written in Russian");
  // Headline framing problems the writer can fix by reframing; a story whose point is a
  // death toll or a foreign election should not have been selected in the first place.
  if (violatesCasualtyPolicy(en)) problems.push("headline-policy:casualties — the English title and description must not mention killing, deaths or casualty figures; lead with the decision, escalation or diplomacy instead");
  if (RU_CASUALTY.test(`${ru.title} ${ru.description}`)) problems.push("headline-policy:casualties — the Russian title and description must not mention deaths or victims");
  if (foreignElectionMarket(`${en.title} ${en.description}`)) problems.push("headline-policy:foreign-election — do not frame the title or description around a non-US election or vote; keep them on the development itself");
  return problems;
}
