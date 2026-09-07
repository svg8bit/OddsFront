"use client";
import Link from "next/link";
import { Languages, Map, Newspaper, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { LANGUAGE_NAMES } from "@/lib/news/locale";
import { LOCALES, type Locale } from "@/lib/news/types";
import { newsPath } from "@/lib/news/routing";
import styles from "./site-navigation.module.css";

export function SiteNavigation({ mode }: { mode: "map" | "news" }) {
  const { locale, automatic, t, setPreferences } = useLocale();
  const [open, setOpen] = useState(false);
  const navigation=useRef<HTMLElement>(null);
  useEffect(()=>{if(!open)return;const dismiss=(event:PointerEvent)=>{if(!navigation.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);navigation.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();}};document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape);};},[open]);
  return <nav ref={navigation} className={`${styles.navigation} ${mode === "map" ? styles.floating : ""}`} aria-label={t("language")}>
    <Link href={mode === "map" ? newsPath(locale) : "/"} prefetch={false}>{mode === "map" ? <Newspaper size={15}/> : <Map size={15}/>}<span>{t(mode === "map" ? "news" : "map")}</span></Link>
    <button type="button" onClick={() => setOpen(!open)} aria-label={t("language")} aria-expanded={open}><Languages size={16}/><span>{locale.toUpperCase()}</span></button>
    {open ? <section className={styles.preferences} aria-label={t("language")}>
      <div><strong>{t("language")}</strong><button aria-label={t("close")} onClick={() => setOpen(false)}><X size={16}/></button></div>
      <label>{t("language")}<select aria-label={t("language")} value={automatic ? "auto" : locale} onChange={event => setPreferences(event.target.value as Locale | "auto")}>
        <option value="auto">{t("automatic")}</option>{LOCALES.map(value => <option key={value} value={value}>{LANGUAGE_NAMES[value]}</option>)}
      </select></label>
    </section> : null}
  </nav>;
}
