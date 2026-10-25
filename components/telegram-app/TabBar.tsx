"use client";

import { Globe2, Ticket, Wallet } from "lucide-react";
import { useMiniApp, type Tab } from "./Provider";
import styles from "./mini-app.module.css";

/** Telegram-native bottom tabs: Рынки · Мои ставки · Кошелёк. */
export function TabBar() {
  const app = useMiniApp();
  const { copy, tab, view } = app;
  const tabs: Array<{ id: Tab; label: string; Icon: typeof Globe2 }> = [
    { id: "markets", label: copy.tabMarkets, Icon: Globe2 },
    { id: "bets", label: copy.tabBets, Icon: Ticket },
    { id: "wallet", label: copy.tabWallet, Icon: Wallet },
  ];
  return (
    <nav className={styles.tabBar} aria-label="OddsFront">
      {tabs.map(({ id, label, Icon }) => {
        const active = id === tab && view === "";
        return (
          <button
            key={id}
            type="button"
            className={active ? styles.tabButtonActive : styles.tabButton}
            aria-current={active ? "page" : undefined}
            onClick={() => app.selectTab(id)}
          >
            <Icon className={styles.tabIcon} size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
            <span className={styles.tabLabel}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
