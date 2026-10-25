"use client";
import { ArrowUpRight } from "lucide-react";
import { useLocale } from "./locale-provider";
import type { Locale } from "@/lib/news/types";
import styles from "./telegram-channel.module.css";

const CHANNELS: Record<Locale, string> = { en: "https://t.me/oddsfront", ru: "https://t.me/oddsfront_ru" };

export function telegramChannelUrl(locale: Locale): string {
  return CHANNELS[locale];
}

export function TelegramIcon({ size = 18 }: { size?: number }) {
  return <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="#2aabee"/>
    <path fill="#fff" d="M5.43 11.87c3.5-1.52 5.83-2.53 7-3.02 3.33-1.39 4.02-1.63 4.47-1.64.1 0 .32.02.47.14.12.1.15.23.17.33.02.1.04.31.02.48-.18 1.9-.96 6.51-1.36 8.64-.17.9-.5 1.2-.82 1.23-.7.06-1.22-.46-1.9-.9-1.05-.69-1.64-1.12-2.66-1.79-1.18-.78-.42-1.2.26-1.9.18-.19 3.24-2.97 3.3-3.22 0-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.35-.48.33-.91.49-1.3.48-.43-.01-1.25-.24-1.86-.44-.75-.24-1.35-.37-1.3-.79.03-.22.33-.44.89-.67z"/>
  </svg>;
}

/** The OddsFront Telegram channel for the reader's language: a header pill or a call to action. */
export function TelegramChannelLink({ variant }: { variant: "pill" | "cta" }) {
  const { locale, t } = useLocale();
  const href = telegramChannelUrl(locale);
  if (variant === "pill") {
    return <a className={styles.pill} href={href} target="_blank" rel="noopener" aria-label={t("telegramChannel")}>
      <TelegramIcon size={17}/><span>{t("telegram")}</span>
    </a>;
  }
  return <a className={styles.cta} href={href} target="_blank" rel="noopener">
    <TelegramIcon size={18}/><span>{t("telegramFollow")}</span><ArrowUpRight size={14} aria-hidden="true"/>
  </a>;
}
