import { notFound } from "next/navigation";
import { LocaleProvider } from "@/components/locale-provider";
import { normalizeLocale } from "@/lib/news/locale";
import { localeSegment, NON_ENGLISH_LOCALES } from "@/lib/news/routing";

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
  return <LocaleProvider fixedLocale={locale}>{children}</LocaleProvider>;
}
