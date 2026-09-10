"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowUpRight, ArrowRight, Search, Send } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useLocale } from "@/components/locale-provider";
import { SiteNavigation } from "@/components/site-navigation";
import { articleText, localeDirection } from "@/lib/news/locale";
import type { NewsArticle } from "@/lib/news/types";
import type { ConflictPreviewEvent, ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { useLiveConflictFeed } from "@/features/global-conflict-map/preview/use-live-conflict-feed";
import { relatedMarkets } from "@/lib/news/related-markets";
import { buildDropsBotTrackUrl, toPolymarketReferralUrl } from "@/lib/polymarket-links";
import { CountryFlag } from "@/features/global-conflict-map/preview/country-flag";
import { availableNewsArticlePath, newsArticlePath, newsPath, newsTopicPath } from "@/lib/news/routing";
import { NEWS_CATEGORIES, articleCategory, categoryLabel, allNewsLabel, newsCategoriesLabel, type NewsCategory } from "@/lib/news/categories";
import styles from "./news.module.css";
import { useArticleReadership } from "./use-article-readership";
import { NEWS_INDEX_PAGE_SIZE } from "@/lib/news/index-page";

export function articlePath(article: NewsArticle) { return newsArticlePath(article, "en"); }

export function NewsChrome({ children }: { children: React.ReactNode }) {
  const { t, locale } = useLocale();
  return <div className={styles.page} dir={localeDirection(locale)}>
    <header className={styles.header}><div className={styles.headerInner}><Link className={styles.wordmark} href={newsPath(locale)} prefetch={false} dir="ltr"><Image className={styles.brandMark} src="/brand/oddsfront-mark-v1.svg" alt="" width={30} height={23} unoptimized/><strong>OddsFront</strong><span> / {t("news")}</span></Link><SiteNavigation mode="news"/></div></header>
    <main className={styles.content}>{children}</main>
    <footer className={styles.footer}><span>© {new Date().getUTCFullYear()} OddsFront</span><a href="https://t.me/oddsfront" target="_blank" rel="noreferrer"><Send size={13}/>Telegram EN</a><a href="https://t.me/oddsfront_ru" target="_blank" rel="noreferrer"><Send size={13}/>Telegram RU</a></footer>
  </div>;
}

function StoryArt({ article, featured = false, headingLevel = "h2" }: { article: NewsArticle; featured?: boolean; headingLevel?: "h1" | "h2" }) {
  const { locale } = useLocale();
  const text = articleText(article, locale);
  const Heading = headingLevel;
  const mediaSource = article.sources.find(source => source.kind === "media");
  const [coverState, setCoverState] = useState<"loading" | "loaded" | "failed">(
    mediaSource ? "loading" : "failed",
  );
  return <div className={`${styles.art} ${featured ? styles.featuredArt : ""}`} data-cover-state={coverState}>
    <div className={styles.artGrid} aria-hidden="true"/><div className={styles.artMap} aria-hidden="true"/>
    {mediaSource && coverState !== "failed" ? <Image className={styles.partnerCover} src={`/api/news-image/${encodeURIComponent(article.slug)}`} alt="" fill sizes={featured?"(max-width: 760px) 100vw, 50vw":"(max-width: 760px) 100vw, 33vw"} loading={featured?"eager":"lazy"} fetchPriority={featured?"high":"auto"} onLoad={()=>setCoverState("loaded")} onError={()=>setCoverState("failed")}/> : null}
    <div className={styles.artShade} aria-hidden="true"/>
    <div className={styles.coverContent}>
      <div className={styles.coverStory}><Heading className={styles.coverTitle}>{text.title}</Heading></div>
    </div>
  </div>;
}

function StoryCard({ article, featured = false }: { article: NewsArticle; featured?: boolean }) {
  const { locale, t } = useLocale(); const text = articleText(article,locale);
  return <Link className={`${styles.card} ${featured ? styles.featuredCard : ""}`} href={availableNewsArticlePath(article, locale)} prefetch={false}>
    <StoryArt key={article.slug} article={article} featured={featured}/>
    <div className={styles.cardBody}><span className={styles.eyebrow}>{categoryLabel(articleCategory(article),locale)}</span>
      <p>{text.description}</p><div className={styles.cardMeta}><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(article.publishedAt))}</time><span>{article.readingMinutes ?? Math.max(1,Math.ceil(article.body.map(block=>block.text).join(" ").split(/\s+/).length/220))} {t("minute")}</span><ArrowRight size={17}/></div>
    </div>
  </Link>;
}

export function NewsOverview({ initialArticles, initialUpdatedAt, initialPopular, initialTotal, activeCountry, activeCategory, archive = false }: { initialArticles: NewsArticle[]; initialUpdatedAt: string; initialPopular?: NewsArticle[]; initialTotal?: number; activeCountry?: string; activeCategory?: NewsCategory; archive?: boolean }) {
  const { locale, country, t } = useLocale();
  const [articles,setArticles] = useState(initialArticles);
  const [popularArticles,setPopularArticles] = useState(initialPopular ?? initialArticles);
  const [total,setTotal] = useState(initialTotal ?? initialArticles.length);
  const newestEdition=useRef(Date.parse(initialUpdatedAt));
  const [query,setQuery] = useState(""); const [limit,setLimit] = useState(13);
  const selected = activeCountry ?? "ALL";
  const pageCount = Math.ceil(limit / NEWS_INDEX_PAGE_SIZE);
  useEffect(() => {
    const controller = new AbortController(); let pending=false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      try {
        const incoming: NewsArticle[] = []; let timestamp = ""; let count = 0; let popular: NewsArticle[] = [];
        let offset = 0;
        for (let page = 0; page < pageCount; page++) {
          const params = new URLSearchParams({ offset: String(offset), country: selected, lang: locale });
          if (activeCategory) params.set("category", activeCategory);
          if (query.trim()) params.set("q", query.trim().slice(0, 160));
          const response = await fetch(`/api/news?${params}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json();
          if (!Array.isArray(data.articles) || !Number.isFinite(Date.parse(data.updatedAt)) ||
            (timestamp && data.updatedAt !== timestamp)) return;
          timestamp = data.updatedAt; incoming.push(...data.articles);
          count = Number.isSafeInteger(data.total) ? data.total : incoming.length;
          popular = Array.isArray(data.popular) ? data.popular : incoming;
          if (!Number.isSafeInteger(data.nextOffset) || data.nextOffset <= offset) break;
          offset = data.nextOffset;
        }
        if (Date.parse(timestamp) >= newestEdition.current && !controller.signal.aborted) {
          newestEdition.current = Date.parse(timestamp); setArticles(incoming); setPopularArticles(popular); setTotal(count);
        }
      } catch { /* Keep the last complete page during a failed or interrupted refresh. */ }
      finally { pending = false; }
    };
    const firstRefresh=setTimeout(refresh,query.trim()?250:0); const interval=setInterval(refresh,60_000); window.addEventListener("focus",refresh); window.addEventListener("pageshow",refresh);
    return ()=>{controller.abort();clearTimeout(firstRefresh);clearInterval(interval);window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh);};
  },[selected,activeCategory,query,locale,pageCount]);
  const filtered=articles.filter(article=>(selected==="ALL"||article.countries.includes(selected))&&(!activeCategory||articleCategory(article)===activeCategory)&&`${articleText(article,locale).title} ${articleText(article,locale).description}`.toLowerCase().includes(query.toLowerCase()));
  const featured=filtered[0];
  const popular=popularArticles.filter(article=>Number.isSafeInteger(article.views7d)&&(article.views7d??0)>0).toSorted((left,right)=>(right.views7d??0)-(left.views7d??0)||Date.parse(right.publishedAt)-Date.parse(left.publishedAt)||left.id.localeCompare(right.id)).slice(0,5);
  return <NewsChrome>
    <section className={styles.intro}><div><h1>{archive?t("archive"):activeCategory?categoryLabel(activeCategory,locale):selected==="ALL"?t("latest"):country(selected)}</h1><p>{t("description")}</p></div><label className={styles.search}><Search size={16}/><input type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event=>{setQuery(event.target.value);setLimit(13);}}/></label></section>
    <nav className={styles.filters} aria-label={newsCategoriesLabel(locale)}><Link href={newsPath(locale)} aria-current={!activeCategory&&selected==="ALL"?"page":undefined} prefetch={false}>{allNewsLabel(locale)}</Link>{NEWS_CATEGORIES.map(topic=><Link key={topic} href={newsTopicPath(topic,locale)} aria-current={activeCategory===topic?"page":undefined} prefetch={false}>{categoryLabel(topic,locale)}</Link>)}</nav>
    <div className={styles.overviewGrid}><section aria-label={t("latest")}>{featured?<StoryCard article={featured} featured/>:<div className={styles.empty}>{query||activeCategory?t("noResults"):t("empty")}</div>}<div className={styles.cardGrid}>{filtered.slice(1,limit).map(article=><StoryCard key={article.id} article={article}/>)}</div>{total>limit?<button className={styles.loadMore} onClick={()=>setLimit(limit+12)}>{t("loadMore")}</button>:null}</section>
      <aside className={styles.latestRail} aria-label={t("popular")}><span className={styles.eyebrow}>{t("popular")}</span>{popular.length?popular.map((article,index)=><Link key={article.id} href={availableNewsArticlePath(article,locale)} prefetch={false}><span>{String(index+1).padStart(2,"0")}</span><div><h3>{articleText(article,locale).title}</h3><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{month:"short",day:"numeric"}).format(new Date(article.publishedAt))}</time></div></Link>):<p className={styles.popularEmpty}>{t("popularEmpty")}</p>}</aside>
    </div>
  </NewsChrome>;
}

type HistoryPoint = { t: number; p: number };

function ProbabilitySparkline({ points, title }: { points: HistoryPoint[]; title: string }) {
  if (points.length < 2) return <div className={styles.sparklineEmpty} aria-label={`${title}: history unavailable`}>—</div>;
  const values = points.map((point) => point.p);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(.04, maximum - minimum);
  const path = points.map((point, index) => {
    const x = 3 + (index / (points.length - 1)) * 94;
    const y = 31 - ((point.p - minimum) / range) * 26;
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className={styles.sparkline} viewBox="0 0 100 36" role="img" aria-label={`${title}: all-time probability history`} preserveAspectRatio="none"><path className={styles.sparklineArea} d={`${path} L97 35 L3 35 Z`}/><path className={styles.sparklineLine} d={path}/></svg>;
}

function LiveMarketCard({ event, fresh, history = [] }: { event: ConflictPreviewEvent; fresh: boolean; history?: HistoryPoint[] }) {
  const { t,translate,locale }=useLocale(); const market=toPolymarketReferralUrl(event.marketUrl); const track=buildDropsBotTrackUrl(event.marketUrl);
  const weekly=event.priceChange7d===null?null:event.priceChange7d*100;
  return <article className={styles.marketCard} data-testid="news-related-market"><div className={styles.marketKicker}><span className={fresh?styles.liveDot:undefined}/>{t(fresh?"live":"updated")}<span>{event.countryCodes.slice(0,3).map(code=><CountryFlag key={code} code={code}/>)}</span></div><div className={styles.marketHeadline}>{event.imageUrl?<span className={styles.marketImage} aria-hidden="true"><Image src={`/api/market-image/${encodeURIComponent(event.id)}`} alt="" width={42} height={42} loading="lazy" onError={image=>{image.currentTarget.parentElement?.setAttribute("hidden","");}} data-market-image/></span>:null}<h3>{translate(event.title)}</h3></div><div className={styles.marketMetrics} dir="ltr"><div className={styles.currentProbability}><span>{t("yes")}</span><strong>{event.yesOdds}%</strong></div><div className={styles.marketTrend}><div><span>MAX</span>{weekly===null?null:<strong data-direction={weekly>=0?"up":"down"}>{weekly>=0?"+":""}{weekly.toFixed(1)}% <small>7D</small></strong>}</div><ProbabilitySparkline points={history} title={translate(event.title)}/></div></div><div className={styles.marketVolume}>{t("volume")} <b dir="ltr">{new Intl.NumberFormat(locale,{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1}).format(event.marketVolume??event.volume)}</b></div><div className={styles.marketActions}>{track?<a href={track} target="_blank" rel="noreferrer"><Send size={14} aria-hidden="true"/>{t("track")}</a>:null}{market?<a href={market} target="_blank" rel="noreferrer">{t("market")}<ArrowUpRight size={14}/></a>:null}</div></article>;
}

export function NewsArticleView({ article, initialFeed }: { article: NewsArticle; initialFeed: ConflictPreviewFeed }) {
  useArticleReadership(article.slug);
  const { locale,t }=useLocale(); const text=articleText(article,locale); const feed=useLiveConflictFeed(initialFeed,false); const events=relatedMarkets(article,feed.events);
  const [histories,setHistories]=useState<Record<string,HistoryPoint[]>>({});
  const eventIds=events.map(event=>event.id).join(",");
  useEffect(()=>{if(!eventIds)return;const controller=new AbortController();fetch(`/api/market-history?eventIds=${encodeURIComponent(eventIds)}`,{signal:controller.signal}).then(response=>response.ok?response.json():null).then(data=>{if(data?.histories&&!controller.signal.aborted)setHistories(Object.fromEntries(Object.entries(data.histories).map(([id,value])=>[id,Array.isArray((value as {points?:unknown}).points)?(value as {points:HistoryPoint[]}).points:[]])));}).catch(()=>{});return()=>controller.abort();},[eventIds]);
  const translated=locale!=="en"&&Boolean(article.translations[locale]);
  const [clock,setClock]=useState(()=>Date.now());useEffect(()=>{const interval=setInterval(()=>setClock(Date.now()),30_000);return ()=>clearInterval(interval);},[]);
  const fresh=(clock||Date.parse(feed.updatedAt))-Date.parse(feed.updatedAt)<90_000 && feed.dataMode==="live";
  return <NewsChrome><Link className={styles.back} href={newsPath(locale)} prefetch={false}><ArrowLeft size={15}/>{t("back")}</Link><div className={styles.articleGrid}><article className={styles.article} lang={translated?locale:"en"} dir={localeDirection(translated?locale:"en")}>
    <StoryArt key={article.slug} article={article} featured headingLevel="h1"/>
    <div className={styles.articleLead}><p>{text.description}</p><div className={styles.byline}><strong>{article.author}</strong><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(article.publishedAt))}</time></div>{translated?<p className={styles.translationNote}>{t("translated")} · <a href={newsArticlePath(article,"en")}>{t("original")}</a></p>:null}</div>
    <div className={styles.prose}>{text.body.map((block,index)=>block.type==="heading"?<h2 key={index}>{block.text}</h2>:<p key={index}>{block.text}</p>)}</div>
    </article><aside className={styles.marketRail} aria-label={t("related")}><span className={styles.eyebrow}>{t("related")}</span>{events.length?events.map(event=><LiveMarketCard key={event.id} event={event} fresh={fresh} history={histories[event.id]}/>):<div className={styles.empty}>{t("unavailable")}<Link href="/" prefetch={false}>{t("browseMap")}<ArrowUpRight size={14}/></Link></div>}</aside></div></NewsChrome>;
}
