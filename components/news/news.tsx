"use client";
// Overview, country navigation, article/source layout and latest rail adapted
// from ColdMath News; the visual system and market actions belong to OddsFront.
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ArrowRight, Search } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useLocale } from "@/components/locale-provider";
import { SiteNavigation } from "@/components/site-navigation";
import { NEWS_SOURCES } from "@/lib/news/sources";
import { articleText, localeDirection } from "@/lib/news/locale";
import type { NewsArticle } from "@/lib/news/types";
import type { ConflictPreviewEvent, ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { useLiveConflictFeed } from "@/features/global-conflict-map/preview/use-live-conflict-feed";
import { relatedMarkets } from "@/lib/news/related-markets";
import { buildDropsBotTrackUrl, toPolymarketReferralUrl } from "@/lib/polymarket-links";
import { CountryFlag } from "@/features/global-conflict-map/preview/country-flag";
import styles from "./news.module.css";

export function articlePath(article: NewsArticle) { return `/news/${(article.countries[0] || "world").toLowerCase()}/${article.slug}`; }

export function NewsChrome({ children }: { children: React.ReactNode }) {
  const { t, locale } = useLocale();
  return <div className={styles.page} dir={localeDirection(locale)}>
    <header className={styles.header}><Link className={styles.wordmark} href="/news" prefetch={false}>OddsFront<span> / {t("news")}</span></Link><SiteNavigation mode="news"/></header>
    <main className={styles.content}>{children}</main>
    <footer className={styles.footer}><span>© {new Date().getUTCFullYear()} OddsFront</span><Link href="/news/archive" prefetch={false}>{t("archive")}</Link><Link href="/news/about" prefetch={false}>{t("about")}</Link><a href="/news/rss.xml">{t("feed")}</a><Link href="/" prefetch={false}>{t("browseMap")}<ArrowUpRight size={13}/></Link></footer>
  </div>;
}

function StoryArt({ article, featured = false }: { article: NewsArticle; featured?: boolean }) {
  const { country, translate, t } = useLocale();
  const primary = article.countries[0] || "WORLD";
  return <div className={`${styles.art} ${featured ? styles.featuredArt : ""}`} data-country={primary} aria-hidden="true">
    <div className={styles.artGrid}/><div className={styles.artMap}/>
    <span className={styles.artTop}>ODDSFRONT / {translate("World desk")}</span>
    <span className={styles.artLocation}>{primary.length === 2 ? <CountryFlag code={primary}/> : null}{primary.length === 2 ? country(primary) : t("news")}</span>
    <span className={styles.artCode}>{primary}</span>
    <span className={styles.artBottom}>{article.topics.slice(0,2).map(translate).join(" · ")}</span>
  </div>;
}

function StoryCard({ article, featured = false }: { article: NewsArticle; featured?: boolean }) {
  const { locale, t, country } = useLocale(); const text = articleText(article,locale);
  return <Link className={`${styles.card} ${featured ? styles.featuredCard : ""}`} href={`${articlePath(article)}?lang=${locale}`} prefetch={false}>
    <StoryArt article={article} featured={featured}/>
    <div className={styles.cardBody}><span className={styles.eyebrow}>{article.countries.slice(0,2).map(country).join(" / ") || t("news")}</span>
      <h2>{text.title}</h2><p>{text.description}</p><div className={styles.cardMeta}><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(article.publishedAt))}</time><span>{article.readingMinutes ?? Math.max(1,Math.ceil(article.body.map(block=>block.text).join(" ").split(/\s+/).length/220))} {t("minute")}</span><ArrowRight size={17}/></div>
    </div>
  </Link>;
}

export function NewsOverview({ initialArticles, initialUpdatedAt, activeCountry, archive = false }: { initialArticles: NewsArticle[]; initialUpdatedAt: string; activeCountry?: string; archive?: boolean }) {
  const { locale, region, country, t } = useLocale();
  const [articles,setArticles] = useState(initialArticles);
  const newestEdition=useRef(Date.parse(initialUpdatedAt));
  const [query,setQuery] = useState(""); const [limit,setLimit] = useState(13);
  const selected = activeCountry ?? (articles.some(article => article.countries.includes(region)) ? region : "ALL");
  useEffect(() => {
    const controller = new AbortController(); let pending=false;
    const refresh = () => { if (document.visibilityState === "hidden" || pending) return; pending=true; void fetch("/api/news",{cache:"no-store",signal:controller.signal}).then(response=>response.ok?response.json():null).then(data=>{if(Array.isArray(data?.articles)&&Date.parse(data.updatedAt)>=newestEdition.current&&!controller.signal.aborted){newestEdition.current=Date.parse(data.updatedAt);setArticles(data.articles);}}).catch(()=>{}).finally(()=>{pending=false;}); };
    refresh(); const interval=setInterval(refresh,60_000); window.addEventListener("focus",refresh); window.addEventListener("pageshow",refresh);
    return ()=>{controller.abort();clearInterval(interval);window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh);};
  },[]);
  const countries=[...new Set(articles.flatMap(article=>article.countries))].sort((a,b)=>country(a).localeCompare(country(b),locale));
  const filtered=articles.filter(article=>(selected==="ALL"||article.countries.includes(selected))&&`${articleText(article,locale).title} ${articleText(article,locale).description}`.toLowerCase().includes(query.toLowerCase()));
  const featured=filtered[0];
  return <NewsChrome>
    <section className={styles.intro}><div><span className={styles.eyebrow}>ODDSFRONT / {t("news")}</span><h1>{archive?t("archive"):selected==="ALL"?t("latest"):country(selected)}</h1><p>{t("description")}</p></div><label className={styles.search}><Search size={16}/><input type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event=>setQuery(event.target.value)}/></label></section>
    <nav className={styles.filters} aria-label={t("countryNews")}><Link href={`/news/world?lang=${locale}`} aria-current={selected==="ALL"?"page":undefined} prefetch={false}>{t("all")}</Link>{countries.map(code=><Link key={code} href={`/news/${code.toLowerCase()}?lang=${locale}`} aria-current={selected===code?"page":undefined} prefetch={false}><CountryFlag code={code}/>{country(code)}</Link>)}</nav>
    <div className={styles.overviewGrid}><section aria-label={t("latest")}>{featured?<StoryCard article={featured} featured/>:<div className={styles.empty}>{query?t("noResults"):t("empty")}</div>}<div className={styles.cardGrid}>{filtered.slice(1,limit).map(article=><StoryCard key={article.id} article={article}/>)}</div>{filtered.length>limit?<button className={styles.loadMore} onClick={()=>setLimit(limit+12)}>{t("loadMore")}</button>:null}</section>
      <aside className={styles.latestRail}><span className={styles.eyebrow}>{t("latest")}</span>{articles.slice(0,5).map((article,index)=><Link key={article.id} href={`${articlePath(article)}?lang=${locale}`} prefetch={false}><span>{String(index+1).padStart(2,"0")}</span><div><h3>{articleText(article,locale).title}</h3><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{month:"short",day:"numeric"}).format(new Date(article.publishedAt))}</time></div></Link>)}<div className={styles.sourceBox}><span className={styles.eyebrow}>{t("sources")}</span>{NEWS_SOURCES.map(source=><a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight size={12}/></a>)}</div></aside>
    </div>
  </NewsChrome>;
}

function LiveMarketCard({ event, fresh }: { event: ConflictPreviewEvent; fresh: boolean }) {
  const { t,translate,locale }=useLocale(); const market=toPolymarketReferralUrl(event.marketUrl); const track=buildDropsBotTrackUrl(event.marketUrl);
  return <article className={styles.marketCard} data-testid="news-related-market"><div className={styles.marketKicker}><span className={fresh?styles.liveDot:undefined}/>{t(fresh?"live":"updated")}<span>{event.countryCodes.slice(0,3).map(code=><CountryFlag key={code} code={code}/>)}</span></div><h3>{translate(event.title)}</h3><div className={styles.marketOdds} dir="ltr"><div><span>{t("yes")}</span><strong>{event.yesOdds}%</strong></div><div><span>{t("no")}</span><strong>{event.noOdds}%</strong></div></div><div className={styles.marketVolume}>{t("volume")} <b dir="ltr">{new Intl.NumberFormat(locale,{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1}).format(event.marketVolume??event.volume)}</b></div><div className={styles.marketActions}>{track?<a href={track} target="_blank" rel="noreferrer">{t("track")}</a>:null}{market?<a href={market} target="_blank" rel="noreferrer">{t("market")}<ArrowUpRight size={14}/></a>:null}</div></article>;
}

export function NewsArticleView({ article, initialFeed }: { article: NewsArticle; initialFeed: ConflictPreviewFeed }) {
  const { locale,t,country }=useLocale(); const text=articleText(article,locale); const feed=useLiveConflictFeed(initialFeed,false); const events=relatedMarkets(article,feed.events);
  const translated=locale!=="en"&&Boolean(article.translations[locale]);
  const [clock,setClock]=useState(()=>Date.now());useEffect(()=>{const interval=setInterval(()=>setClock(Date.now()),30_000);return ()=>clearInterval(interval);},[]);
  const fresh=(clock||Date.parse(feed.updatedAt))-Date.parse(feed.updatedAt)<90_000 && feed.dataMode==="live";
  return <NewsChrome><Link className={styles.back} href={`/news?lang=${locale}`} prefetch={false}><ArrowLeft size={15}/>{t("back")}</Link><div className={styles.articleGrid}><article className={styles.article} lang={translated?locale:"en"} dir={localeDirection(translated?locale:"en")}>
    <header className={styles.articleHeader}><div className={styles.eyebrow}>{article.countries.map(code=><Link href={`/news/${code.toLowerCase()}?lang=${locale}`} key={code} prefetch={false}>{country(code)}</Link>)}</div><h1>{text.title}</h1><p>{text.description}</p><div className={styles.byline}><strong>{article.author}</strong><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(article.publishedAt))}</time></div>{translated?<p className={styles.translationNote}>{t("translated")} · <a href={`${articlePath(article)}?lang=en`}>{t("original")}</a></p>:null}</header>
    <StoryArt article={article} featured/>
    <div className={styles.prose}>{text.body.map((block,index)=>block.type==="heading"?<h2 key={index}>{block.text}</h2>:<p key={index}>{block.text}</p>)}</div>
    <section className={styles.articleSources}><h2>{t("sources")}</h2>{article.sources.map(source=><a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{source.publisher}</span><strong>{source.title}<ArrowUpRight size={13}/></strong><time dateTime={source.publishedAt}>{t("sourceDate")}: {new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(source.publishedAt))}</time></a>)}</section>
    </article><aside className={styles.marketRail} aria-label={t("related")}><span className={styles.eyebrow}>{t("related")}</span>{events.length?events.map(event=><LiveMarketCard key={event.id} event={event} fresh={fresh}/>):<div className={styles.empty}>{t("unavailable")}<Link href="/" prefetch={false}>{t("browseMap")}<ArrowUpRight size={14}/></Link></div>}</aside></div></NewsChrome>;
}
