import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { newsIndex } from "@/lib/news/publication";
import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsMetadata } from "@/lib/news/metadata";
import { newsCountryPath } from "@/lib/news/routing";
export const revalidate=60;
type Props={params:Promise<{country:string}>;searchParams:Promise<{lang?:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{return newsMetadata("en",(await params).country);}
export default async function CountryNews({params,searchParams}:Props){const {country}=await params;if(country!=="world"&&!/^[a-z]{2}$/.test(country))notFound();const locale=normalizeLocale((await searchParams).lang);if(locale)permanentRedirect(newsCountryPath(country,locale));const catalog=await getNewsCatalog();return <NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt} activeCountry={country==="world"?"ALL":country.toUpperCase()}/>;}
