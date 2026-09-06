"use client";
import Link from "next/link";
import { Languages, Map, Newspaper, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { LANGUAGE_NAMES } from "@/lib/news/locale";
import { LOCALES, type Locale } from "@/lib/news/types";
import styles from "./site-navigation.module.css";

const REGIONS = ["US","GB","CN","KR","VN","DE","ES","BR","FR","RU","UA","IR","IL","PS","LB","SY","IQ","SD","YE","TW","IN","PK","AF","VE","ET","TR"];
export function SiteNavigation({ mode }: { mode: "map" | "news" }) {
  const { locale, region, automatic, country, t, setPreferences } = useLocale();
  const [open, setOpen] = useState(false);
  const navigation=useRef<HTMLElement>(null);
  useEffect(()=>{if(!open)return;const dismiss=(event:PointerEvent)=>{if(!navigation.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);navigation.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();}};document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape);};},[open]);
  return <nav ref={navigation} className={`${styles.navigation} ${mode === "map" ? styles.floating : ""}`} aria-label={t("settings")}>
    <Link href={mode === "map" ? "/news" : "/"} prefetch={false}>{mode === "map" ? <Newspaper size={15}/> : <Map size={15}/>}<span>{t(mode === "map" ? "news" : "map")}</span></Link>
    <button type="button" onClick={() => setOpen(!open)} aria-label={t("settings")} aria-expanded={open}><Languages size={16}/><span>{locale.toUpperCase()}</span></button>
    {open ? <section className={styles.preferences} aria-label={t("settings")}>
      <div><strong>{t("settings")}</strong><button aria-label={t("close")} onClick={() => setOpen(false)}><X size={16}/></button></div>
      <label>{t("language")}<select aria-label={t("language")} value={automatic ? "auto" : locale} onChange={event => setPreferences(event.target.value as Locale | "auto", region)}>
        <option value="auto">{t("automatic")}</option>{LOCALES.map(value => <option key={value} value={value}>{LANGUAGE_NAMES[value]}</option>)}
      </select></label>
      <label>{t("region")}<select aria-label={t("region")} value={region} onChange={event => setPreferences(automatic ? "auto" : locale, event.target.value)}>
        <option value="ALL">{t("all")}</option>{[...new Set([...REGIONS, ...(region === "ALL" ? [] : [region])])].map(code => <option key={code} value={code}>{country(code)}</option>)}
      </select></label>
    </section> : null}
  </nav>;
}
