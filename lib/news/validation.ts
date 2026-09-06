// Adapted from ColdMath's evidence, originality and duplicate publication gates.
import type { NewsAlert, NewsArticle, NewsDraft } from "./types.ts";
import { isNewsPublisher, isOfficialSource, sourceHost } from "./sources.ts";

export function normalizedWords(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}

export function isDuplicateTitle(title: string, existing: Pick<NewsArticle, "title">[]) {
  const left = new Set(normalizedWords(title).filter(word => word.length > 3));
  return existing.some(article => {
    const right = new Set(normalizedWords(article.title).filter(word => word.length > 3));
    const shared = [...left].filter(word => right.has(word)).length;
    return shared / Math.max(1, Math.min(left.size, right.size)) >= 0.72;
  });
}

const ALERT_COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  US: ["united states", "u s", "american"],
  RU: ["russia", "russian"],
  UA: ["ukraine", "ukrainian"],
  IL: ["israel", "israeli"],
  PS: ["palestine", "palestinian", "gaza"],
  IR: ["iran", "iranian"],
  LB: ["lebanon", "lebanese", "hezbollah"],
  IQ: ["iraq", "iraqi"],
  SY: ["syria", "syrian"],
  YE: ["yemen", "yemeni", "houthi"],
  IN: ["india", "indian"],
  PK: ["pakistan", "pakistani"],
  CN: ["china", "chinese"],
  TW: ["taiwan", "taiwanese"],
  KP: ["north korea", "north korean"],
  KR: ["south korea", "south korean"],
};
const MAJOR_ALERT_PAIRS = new Set([
  "IL-IR", "IL-LB", "IL-PS", "IN-PK", "IQ-US", "IR-US", "KP-KR",
  "CN-TW", "RU-UA", "SY-US", "US-YE",
]);
const STRIKE_LANGUAGE = /\b(?:air\s*strikes?|strikes?|struck|attacks?|attacked|bomb(?:s|ed|ing)?|missile\s+attacks?|military\s+(?:action|operation))\b/i;
const CEASEFIRE_LANGUAGE = /\b(?:ceasefire|truce)\b/i;
const SPECULATIVE_LANGUAGE = /\b(?:could|may|might|plans?|planning|proposal|proposed|talks?|negotiations?|threatens?|considers?|expected|forecast|prediction|will\s+(?:strike|attack|bomb))\b/i;

function mentionsCountry(text: string, code: string): boolean {
  const normalized = ` ${normalizedWords(text).join(" ")} `;
  return (ALERT_COUNTRY_ALIASES[code] ?? []).some(alias =>
    normalized.includes(` ${alias} `),
  );
}

function hasMajorAlertPair(actors: string[], targets: string[]): boolean {
  return actors.some(actor => targets.some(target =>
    MAJOR_ALERT_PAIRS.has([actor, target].sort().join("-")),
  ));
}

export function verifiedNewsAlert(draft: NewsDraft): NewsAlert | null {
  const alert = draft.alert;
  if (
    !alert ||
    alert.eligible !== true ||
    (alert.kind !== "strike" && alert.kind !== "ceasefire")
  ) {
    return null;
  }
  const actors = [...new Set(alert.actorCountries)];
  const targets = [...new Set(alert.targetCountries)];
  const codes = [...actors, ...targets];
  if (
    actors.length < 1 || actors.length > 3 ||
    targets.length < 1 || targets.length > 3 ||
    codes.some(code => !/^[A-Z]{2}$/.test(code) || !draft.countries.includes(code)) ||
    !hasMajorAlertPair(actors, targets)
  ) return null;

  const headline = `${draft.title} ${draft.description}`;
  const actionPattern = alert.kind === "strike" ? STRIKE_LANGUAGE : CEASEFIRE_LANGUAGE;
  if (
    !actionPattern.test(headline) ||
    SPECULATIVE_LANGUAGE.test(headline) ||
    !actors.some(code => mentionsCountry(headline, code)) ||
    !targets.some(code => mentionsCountry(headline, code))
  ) return null;

  const sourceKinds = new Map(draft.sources.map(source => [source.id, source.kind]));
  const confirmedClaim = draft.factChecks.some(fact =>
    actionPattern.test(fact.claim) &&
    actors.some(code => mentionsCountry(fact.claim, code)) &&
    targets.some(code => mentionsCountry(fact.claim, code)) &&
    fact.sourceIds.some(id => sourceKinds.get(id) === "media") &&
    fact.sourceIds.some(id => sourceKinds.get(id) === "official"),
  );
  return confirmedClaim
    ? { kind: alert.kind, actorCountries: actors, targetCountries: targets }
    : null;
}

export function validateNewsDraft(draft: NewsDraft, existing: NewsArticle[], now = new Date()) {
  const reasons: string[] = [];
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.body) || !Array.isArray(draft.sources)) return ["Invalid article structure"];
  if (typeof draft.title !== "string" || typeof draft.description !== "string" ||
      draft.body.length > 50 || draft.sources.length > 12 ||
      !draft.alert || typeof draft.alert.eligible !== "boolean" ||
      !["none", "strike", "ceasefire"].includes(draft.alert.kind) ||
      !Array.isArray(draft.alert.actorCountries) || !Array.isArray(draft.alert.targetCountries) ||
      draft.body.some(block => !block || typeof block.text !== "string" || block.text.length > 8000) ||
      draft.sources.some(source => !source || [source.id,source.title,source.publisher,source.evidence,source.url,source.publishedAt].some(value => typeof value !== "string") || !["official","media"].includes(source.kind)) ||
      !Array.isArray(draft.factChecks) || draft.factChecks.some(fact => !fact || typeof fact.claim !== "string" || !Array.isArray(fact.sourceIds))) return ["Invalid article structure"];
  if (!draft.publishable) reasons.push(draft.rejectionReason || "Unpublishable topic");
  if (!draft.title || draft.title.length > 180 || !draft.description || draft.description.length > 500) reasons.push("Invalid headline or deck");
  const text = draft.body.map(block => block.text).join(" ");
  if (normalizedWords(text).length < 300 || draft.body.filter(block => block.type === "paragraph" && block.text.length >= 100).length < 5) reasons.push("Article is too thin");
  if (draft.body.some(block => !["heading", "paragraph"].includes(block.type) || /<[^>]+>|\[[^\]]+\]\(https?:/i.test(block.text))) reasons.push("Unsafe article blocks");
  const usable = draft.sources.filter(source => source.id && source.title && source.publisher && source.evidence.length >= 160 && (source.kind === "official" ? isOfficialSource(source.url) : isNewsPublisher(source.url)));
  if (usable.length !== draft.sources.length || new Set(usable.map(source => sourceHost(source.url))).size < 2) reasons.push("Two independent verified publishers are required");
  if (!usable.some(source => source.kind === "official")) reasons.push("Primary evidence is missing");
  const recentMedia = usable.filter(source => source.kind === "media" && Date.parse(source.publishedAt) <= now.getTime() + 300_000 && Date.parse(source.publishedAt) >= now.getTime() - 72 * 3600_000);
  if (!recentMedia.length) reasons.push("No fresh source from the configured news publishers");
  const ids = new Set(usable.map(source => source.id));
  if(ids.size!==usable.length || usable.some(source => !Number.isFinite(Date.parse(source.publishedAt)) || Date.parse(source.publishedAt)>now.getTime()+300_000))reasons.push("Invalid source dates or IDs");
  if (!Array.isArray(draft.factChecks) || draft.factChecks.length < 3 || draft.factChecks.some(fact => !fact.claim || !fact.sourceIds.length || fact.sourceIds.some(id => !ids.has(id)))) reasons.push("Claims need source references");
  if (!Array.isArray(draft.countries) || draft.countries.length>12 || draft.countries.some(code => typeof code!=="string" || !/^[A-Z]{2}$/.test(code))) reasons.push("Invalid country tags");
  if (!Array.isArray(draft.topics) || draft.topics.length > 12 || draft.topics.some(topic=>typeof topic!=="string" || topic.length>80)) reasons.push("Invalid topic tags");
  if(!articleSlug(draft.title))reasons.push("Invalid article slug");
  const normalized = ` ${normalizedWords(text).join(" ")} `;
  if (usable.some(source => {
    const words = normalizedWords(source.evidence);
    return words.some((_, index) => index + 12 <= words.length && normalized.includes(` ${words.slice(index, index + 12).join(" ")} `));
  })) reasons.push("Copied source language");
  if (/guaranteed profit|bet now|must-watch|game-changing|dive into/i.test(text)) reasons.push("Promotional or generic language");
  if (isDuplicateTitle(draft.title, existing) || existing.some(article => article.sources.some(source => usable.some(candidate => candidate.kind === "media" && candidate.url === source.url)))) reasons.push("Already published story");
  return reasons;
}

export function articleSlug(title: string) {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/, "");
}
