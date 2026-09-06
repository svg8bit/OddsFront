import { notFound } from "next/navigation";
import "maplibre-gl/dist/maplibre-gl.css";
import "../globals.css";
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from "@/components/root-document";
import { normalizeLocale } from "@/lib/news/locale";
import { localeSegment, NON_ENGLISH_LOCALES } from "@/lib/news/routing";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export function generateStaticParams() {
  return NON_ENGLISH_LOCALES.map((locale) => ({ locale: localeSegment(locale) }));
}

export default async function LocalizedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: segment } = await params;
  const locale = normalizeLocale(segment);
  if (!locale || locale === "en" || localeSegment(locale) !== segment.toLowerCase()) notFound();
  return <RootDocument locale={locale}>{children}</RootDocument>;
}
