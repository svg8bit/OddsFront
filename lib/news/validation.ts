// Adapted from ColdMath's evidence, originality and duplicate publication gates.
import type { NewsArticle, NewsDraft } from "./types.ts";
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

export function validateNewsDraft(draft: NewsDraft, existing: NewsArticle[], now = new Date()) {
  const reasons: string[] = [];
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.body) || !Array.isArray(draft.sources)) return ["Invalid article structure"];
  if (typeof draft.title !== "string" || typeof draft.description !== "string" ||
      draft.body.length > 50 || draft.sources.length > 12 ||
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
