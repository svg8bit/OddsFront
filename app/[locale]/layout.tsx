import { notFound } from "next/navigation";
import "maplibre-gl/dist/maplibre-gl.css";
import "../globals.css";
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from "@/components/root-document";
import { normalizeLocale } from "@/lib/news/locale";
import { localeSegment } from "@/lib/news/routing";
import { LOCALES } from "@/lib/news/types";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale: localeSegment(locale) }));
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
  if (!locale || localeSegment(locale) !== segment.toLowerCase()) notFound();
  return <RootDocument locale={locale} fixedLocale>{children}</RootDocument>;
}
