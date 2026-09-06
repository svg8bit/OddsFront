import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsArticleView } from "@/components/news/news";
import { getNewsArticle } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { articleMetadata, articleStructuredData } from "@/lib/news/metadata";
import { newsArticlePath } from "@/lib/news/routing";
import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";
type Props={params:Promise<{country:string;slug:string}>;searchParams:Promise<{lang?:string}>};
export const revalidate=60;
export async function generateMetadata({params}:Props):Promise<Metadata>{const {slug}=await params;const article=await getNewsArticle(slug);return article?articleMetadata(article,"en"):{title:"Article not found | OddsFront"};}
export default async function ArticlePage({params,searchParams}:Props){const {country,slug}=await params;const [article,feed]=await Promise.all([getNewsArticle(slug),getConflictPreviewFeed()]);if(!article)notFound();const locale=normalizeLocale((await searchParams).lang);if(locale)permanentRedirect(newsArticlePath(article,locale));const canonicalCountry=(article.countries[0]||"world").toLowerCase();if(country!==canonicalCountry)permanentRedirect(newsArticlePath(article,"en"));const structured=articleStructuredData(article,"en");return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,"\\u003c")}}/><NewsArticleView article={article} initialFeed={feed}/></>;}
