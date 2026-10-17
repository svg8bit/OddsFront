import { NextResponse, type NextRequest } from "next/server";
import { normalizeLocale } from "@/lib/news/locale";
import { newsArchivePath, switchNewsLocalePath } from "@/lib/news/routing";

// News pages used to read `?lang=` and `?page=` through `searchParams`, which
// made every news route render dynamically on each request. Those pages are
// now served from the ISR cache, and this proxy runs only for requests that
// still carry one of the legacy parameters (see `config.matcher` below). It
// redirects once to the canonical path and drops the parameter.
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const target = url.clone();
  const lang = url.searchParams.get("lang");
  if (lang !== null) {
    target.searchParams.delete("lang");
    const locale = normalizeLocale(lang);
    if (locale) target.pathname = switchNewsLocalePath(url.pathname, locale);
  }
  const page = url.searchParams.get("page");
  if (page !== null && /^\/news\/archive\/?$/.test(target.pathname)) {
    target.searchParams.delete("page");
    if (/^[1-9]\d{0,8}$/.test(page)) target.pathname = newsArchivePath(Number(page));
  }
  if (target.pathname === url.pathname && target.search === url.search) return NextResponse.next();
  return NextResponse.redirect(target, 308);
}

export const config = {
  matcher: [
    { source: "/news/:path*", has: [{ type: "query", key: "lang" }] },
    { source: "/:locale(en|zh|ko|vi|de|es|pt-br|fr|ru|uk|fa|he)/news/:path*", has: [{ type: "query", key: "lang" }] },
    { source: "/news/archive", has: [{ type: "query", key: "page" }] },
  ],
};
