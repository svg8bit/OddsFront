import type { NewsArticle } from "./types.ts";

type Story = Pick<NewsArticle, "title" | "body" | "sources">;

// Keep this normalization separate from the verbatim-source evidence gate.
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)
    .filter(word => word.length > 3).map(word => {
      if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
      if (/(?:ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
      return /s$/.test(word) && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
    }));
}

function overlap(left: Set<string>, right: Set<string>) {
  const shared = [...left].filter(word => right.has(word)).length;
  return { shared, ratio: shared / Math.max(1, Math.min(left.size, right.size)) };
}

export function isDuplicateTitle(title: string, existing: Pick<NewsArticle, "title">[]) {
  const left = words(title);
  return existing.some(article => overlap(left, words(article.title)).ratio >= .72);
}

export function canonicalStoryUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch { return ""; }
}

function headlines(story: Story) {
  return [story.title, ...story.sources.filter(source => source.kind === "media").map(source => source.title)].map(words);
}

export function findDuplicateStory(candidate: Story, existing: NewsArticle[]): NewsArticle | undefined {
  const urls = new Set(candidate.sources.filter(source => source.kind === "media").map(source => canonicalStoryUrl(source.url)).filter(Boolean));
  const titles = headlines(candidate);
  const lead = words(candidate.body.find(block => block.type === "paragraph")?.text ?? "");
  return existing.find(article => {
    if (article.sources.some(source => source.kind === "media" && urls.has(canonicalStoryUrl(source.url)))) return true;
    if (isDuplicateTitle(candidate.title, [article])) return true;
    // Compare the actual source headline too: a new angle or publisher URL
    // does not make a previously reported verdict, attack or announcement new.
    if (titles.some(left => headlines(article).some(right => {
      const match = overlap(left, right);
      return match.shared >= 5 && match.ratio >= .8;
    }))) return true;
    // Shared institutional background is deliberately excluded. A matching
    // lead also needs a substantial overlap in the specific headline.
    const headline = overlap(titles[0], words(article.title));
    const introduction = overlap(lead, words(article.body.find(block => block.type === "paragraph")?.text ?? ""));
    return headline.shared >= 4 && headline.ratio >= .5 && introduction.shared >= 12 && introduction.ratio >= .85;
  });
}

export function uniqueEditionArticles(candidates: NewsArticle[], history: NewsArticle[]) {
  const accepted: NewsArticle[] = [];
  const rejected: { article: NewsArticle; duplicateOf: string }[] = [];
  for (const article of candidates) {
    const duplicate = history.find(item => item.id === article.id) ?? findDuplicateStory(article, [...history, ...accepted]);
    if (article.withdrawal || duplicate) rejected.push({ article, duplicateOf: article.withdrawal?.duplicateOf ?? duplicate!.id });
    else accepted.push(article);
  }
  return { accepted, rejected };
}
