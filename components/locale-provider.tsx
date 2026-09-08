"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { countryName, localeDirection, negotiateLocale, normalizeLocale } from "@/lib/news/locale";
import { switchNewsLocalePath } from "@/lib/news/routing";
import { message, type MessageKey } from "@/lib/news/messages";
import type { Locale } from "@/lib/news/types";

const KEY = "oddsfront-preferences-v1";
let memoryPreferences = "auto";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify); window.addEventListener("storage", notify); window.addEventListener("oddsfront-preferences", notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener("storage", notify); window.removeEventListener("oddsfront-preferences", notify); };
};
const getSnapshot = () => { let saved=memoryPreferences; try { saved=localStorage.getItem(KEY) ?? saved; } catch { /* Private storage. */ } return `${saved}\n${location.search}`; };
const getServerSnapshot = () => "server";
interface Preferences { locale: Locale; automatic: boolean; t: (key: MessageKey) => string; translate: (text: string) => string; country: (code: string) => string; setPreferences: (locale: Locale | "auto") => void; }
const LocaleContext = createContext<Preferences>({ locale: "en", automatic: true, t: key => message("en",key), translate: text => text, country: code => countryName(code,"en"), setPreferences: () => {} });

export function LocaleProvider({ children, fixedLocale }: { children: React.ReactNode; fixedLocale?: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const preferences = useMemo(() => {
    let saved: { locale?: string } = {};
    try { saved = JSON.parse(stored.split("\n")[0]) ?? {}; } catch { /* First visit uses browser preferences. */ }
    const browserLanguages = stored === "server" ? [] : navigator.languages;
    const explicit = stored === "server" ? null : normalizeLocale(new URLSearchParams(location.search).get("lang"));
    const pathParts = pathname.split("/").filter(Boolean);
    const pathLocale = pathParts[1] === "news" ? normalizeLocale(pathParts[0]) : null;
    const locale = fixedLocale ?? pathLocale ?? explicit ?? normalizeLocale(saved.locale) ?? negotiateLocale(browserLanguages);
    return { locale, automatic: !explicit && !normalizeLocale(saved.locale) };
  }, [stored, fixedLocale, pathname]);
  const [dictionary, setDictionary] = useState<{ locale: Locale; messages: Record<string,string> }>({ locale: "en", messages: {} });
  useEffect(() => {
    document.documentElement.lang = preferences.locale;
    document.documentElement.dir = localeDirection(preferences.locale);
    if (preferences.locale === "en") return;
    const controller = new AbortController();
    fetch(`/api/localization?lang=${preferences.locale}`, { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then(data => { if (data && !controller.signal.aborted) setDictionary({ locale: preferences.locale, messages: data.messages ?? {} }); }).catch(() => {});
    return () => controller.abort();
  }, [preferences.locale]);
  const value = useMemo<Preferences>(() => ({ ...preferences,
    t: key => message(preferences.locale, key),
    translate: text => dictionary.locale === preferences.locale ? dictionary.messages[text] ?? text : text,
    country: code => countryName(code, preferences.locale),
    setPreferences: (locale) => {
      const resolvedLocale = locale === "auto" ? negotiateLocale(navigator.languages) : locale;
      memoryPreferences = JSON.stringify({ locale });
      const url = new URL(location.href); url.searchParams.delete("lang");
      try { localStorage.setItem(KEY, memoryPreferences); } catch { /* Private mode may disable persistence. */ }
      const localizedPath = switchNewsLocalePath(url.pathname, resolvedLocale);
      if (localizedPath !== url.pathname) {
        url.pathname = localizedPath;
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      } else {
        history.replaceState(history.state, "", url);
      }
      window.dispatchEvent(new Event("oddsfront-preferences"));
    },
  }), [preferences, dictionary, router]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
