export const NEWS_SOURCES = [
  { id: "reuters", name: "Reuters", host: "reuters.com", url: "https://www.reuters.com/world/" },
  { id: "axios", name: "Axios", host: "axios.com", url: "https://www.axios.com/world" },
  { id: "aljazeera", name: "Al Jazeera", host: "aljazeera.com", url: "https://www.aljazeera.com/middle-east/" },
  { id: "kyiv-independent", name: "The Kyiv Independent", host: "kyivindependent.com", url: "https://kyivindependent.com/" },
  { id: "bbc", name: "BBC", host: "bbc.com", url: "https://www.bbc.com/news/world" },
] as const;

export function sourceHost(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.hostname.replace(/^www\./, "") : "";
  } catch { return ""; }
}

export function isNewsPublisher(url: string) {
  const host = sourceHost(url);
  return NEWS_SOURCES.some(source => host === source.host) || host === "bbc.co.uk";
}

// Official institutions are supporting evidence, never a replacement media feed.
export function isOfficialSource(url: string) {
  const host = sourceHost(url);
  return ["un.org", "unhcr.org", "ohchr.org", "iaea.org", "icrc.org", "nato.int", "europa.eu", "consilium.europa.eu", "president.gov.ua", "mfa.gov.ua", "whitehouse.gov", "state.gov", "defense.gov", "gov.uk", "gov.il", "mfa.gov.ir"].some(domain => host === domain || host.endsWith(`.${domain}`));
}
