import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { newsIndex } from "@/lib/news/publication";
import { getNewsCatalog } from "@/lib/news/catalog";
import { countryName } from "@/lib/news/locale";
export const revalidate=60;
export async function generateMetadata({params}:{params:Promise<{country:string}>}):Promise<Metadata>{const {country}=await params;return {title:`${country==="world"?"World":countryName(country.toUpperCase(),"en")} News | OddsFront`,alternates:{canonical:`/news/${country}`}};}
export default async function CountryNews({params}:{params:Promise<{country:string}>}){const {country}=await params;if(country!=="world"&&!/^[a-z]{2}$/.test(country))notFound();const catalog=await getNewsCatalog();return <NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt} activeCountry={country==="world"?"ALL":country.toUpperCase()}/>;}
