import generatedCountryAnchors from "@/features/global-conflict-map/preview/country-anchors.generated.json";
import type {
  PreviewCoordinate,
  PreviewTone,
} from "@/features/global-conflict-map/preview/types";

interface GeneratedCountryAnchor {
  featureId: string;
  iso2: string;
  name: string;
  aliases: string[];
  continent: string;
  region: string;
  coordinates: [number, number];
}

export interface CountryAnchor {
  id: string;
  label: string;
  region: string;
  coordinates: PreviewCoordinate;
  countryCode: string;
  countryFeatureId: string;
  tone: PreviewTone;
  matcher: RegExp;
}

interface CountryAnchorMatch {
  anchor: CountryAnchor;
  index: number;
  length: number;
  targetScore: number;
}

const COMMON_COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  CHN: ["China", "Chinese"],
  CIV: ["Ivory Coast", "Cote d'Ivoire", "Côte d’Ivoire"],
  COD: ["DR Congo", "DRC", "Congo-Kinshasa"],
  COG: ["Congo-Brazzaville"],
  CZE: ["Czech Republic", "Czechia"],
  GBR: ["UK", "U.K.", "Britain", "British"],
  IRN: ["Iran", "Iranian"],
  ISR: ["Israel", "Israeli"],
  KOR: ["South Korea", "Republic of Korea", "South Korean"],
  KOS: ["Kosovo"],
  PRK: ["North Korea", "DPRK", "North Korean"],
  RUS: ["Russia", "Russian Federation", "Russian"],
  TUR: ["Turkey", "Türkiye", "Turkiye", "Turkish"],
  TWN: ["Taiwan", "Taiwanese"],
  UKR: ["Ukraine", "Ukrainian"],
  USA: [
    "United States",
    "United States of America",
    "U.S.",
    "U.S.A.",
    "USA",
    "US",
    "America",
    "American",
  ],
};

const COUNTRY_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  COD: "DR Congo",
  COG: "Republic of the Congo",
  KOR: "South Korea",
  PRK: "North Korea",
  RUS: "Russia",
  USA: "United States",
};

const TARGET_PREFIX_PATTERN =
  /\b(?:invad(?:e|es|ed|ing)|attack(?:s|ed|ing)?|strike(?:s|d|ing)?|annex(?:es|ed|ing|ation)?|capture(?:s|d|ing)?|occup(?:y|ies|ied|ying|ation)|enter(?:s|ed|ing)?|blockade(?:s|d|ing)?|military (?:action|operation|strike)(?:\s+(?:against|in|into|on))?|war (?:against|with|on)|clash (?:against|with|in))\s+(?:the\s+)?(?:[a-z.'’()-]+\s+){0,4}$/i;
const LOCATION_PREFIX_PATTERN =
  /\b(?:against|inside|into|in|on|of|from|over|near)\s+(?:the\s+)?$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(value: string): string {
  return value
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join("[\\s-]+");
}

function countryMatcher(aliases: readonly string[]): RegExp {
  const sources = [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map(aliasPattern);
  return new RegExp(`(?<![A-Za-z])(?:${sources.join("|")})(?![A-Za-z])`, "i");
}

function toneForCountry(anchor: GeneratedCountryAnchor): PreviewTone {
  if (anchor.region === "Western Asia" || anchor.region === "Northern Africa") {
    return "red";
  }
  if (anchor.continent === "Europe") return "violet";
  if (anchor.continent === "Asia" || anchor.continent === "Oceania") {
    return "blue";
  }
  return "orange";
}

export const COUNTRY_ANCHORS: readonly CountryAnchor[] = (
  generatedCountryAnchors as GeneratedCountryAnchor[]
).map((anchor) => {
  const aliases = [
    ...anchor.aliases,
    ...(COMMON_COUNTRY_ALIASES[anchor.featureId] ?? []),
  ];
  return {
    id: `country-${anchor.featureId.toLowerCase()}`,
    label: COUNTRY_LABEL_OVERRIDES[anchor.featureId] ?? anchor.name,
    region: anchor.region || anchor.continent,
    coordinates: anchor.coordinates,
    countryCode: anchor.iso2,
    countryFeatureId: anchor.featureId,
    tone: toneForCountry(anchor),
    matcher: countryMatcher(aliases),
  };
});

function scoreTargetContext(text: string, index: number): number {
  const prefix = text.slice(Math.max(0, index - 110), index);
  if (TARGET_PREFIX_PATTERN.test(prefix)) return 4;
  if (LOCATION_PREFIX_PATTERN.test(prefix)) return 2;
  return 0;
}

function matchCountryAnchors(text: string): CountryAnchorMatch[] {
  const matches: CountryAnchorMatch[] = [];
  for (const anchor of COUNTRY_ANCHORS) {
    const match = anchor.matcher.exec(text);
    if (!match) continue;
    matches.push({
      anchor,
      index: match.index,
      length: match[0].length,
      targetScore: scoreTargetContext(text, match.index),
    });
  }
  return matches;
}

export function resolveCountryAnchor(text: string): CountryAnchor | null {
  const matches = matchCountryAnchors(text);
  matches.sort(
    (left, right) =>
      right.targetScore - left.targetScore ||
      right.length - left.length ||
      right.index - left.index,
  );
  return matches[0]?.anchor ?? null;
}

export function resolveCountryParticipants(text: string): CountryAnchor[] {
  const matches = matchCountryAnchors(text);
  return matches
    .filter(
      (candidate) =>
        !matches.some(
          (other) =>
            other !== candidate &&
            other.length > candidate.length &&
            other.index <= candidate.index &&
            other.index + other.length >= candidate.index + candidate.length,
        ),
    )
    .sort((left, right) => left.index - right.index)
    .map((match) => match.anchor);
}
