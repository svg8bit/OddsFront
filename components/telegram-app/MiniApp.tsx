"use client";

import { ArrowUp } from "lucide-react";
import Script from "next/script";
import { Component, useEffect, useState, type ReactNode } from "react";
import { haptic } from "@/lib/telegram-app/client/webapp";
import { ODDSFRONT_MINI_APP_BOT_USERNAME } from "@/lib/telegram-app/init-data";
import { BetSheet, SuccessScreen } from "./BetSheet";
import { ConnectScreen, FundingScreen, KeyScreen } from "./FundingScreen";
import { MarketsTab } from "./MarketsTab";
import { MyBetsTab } from "./MyBetsTab";
import { MiniAppProvider, useMiniApp } from "./Provider";
import { TabBar } from "./TabBar";
import { WalletTab } from "./WalletTab";
import styles from "./mini-app.module.css";

/**
 * OddsFront inside Telegram: the hottest geopolitics and politics markets, the player's bets and the
 * Telegram account, in three tabs. A channel post's Yes/No button opens the bet sheet straight away;
 * after the first top-up every bet is one tap.
 */

const BOT_URL = `https://t.me/${ODDSFRONT_MINI_APP_BOT_USERNAME}`;

export function TelegramMiniApp() {
  const [scriptReady, setScriptReady] = useState(false);
  return (
    <MiniAppProvider scriptReady={scriptReady}>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <MiniAppShell />
    </MiniAppProvider>
  );
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className={styles.brandMark} width={size} height={Math.round(size * 0.75)} viewBox="0 0 300 224" aria-hidden>
      <defs>
        <linearGradient id="of-mark" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#7778FF" />
          <stop offset="1" stopColor="#5548FF" />
        </linearGradient>
      </defs>
      <path d="M106 0H178L72 224H0Z M228 0H300L194 224H122Z" fill="url(#of-mark)" />
    </svg>
  );
}

function OutsidePage() {
  const { copy } = useMiniApp();
  return (
    <section className={styles.outside}>
      <BrandMark size={64} />
      <h1 className={styles.outsideTitle}>{copy.outsideTitle}</h1>
      <p className={styles.outsideText}>{copy.outside}</p>
      <a className={styles.primary} href={BOT_URL}>{copy.outsideButton}</a>
    </section>
  );
}

/** One broken screen must not take the whole app down: the tab shows a plain retry instead. */
class ScreenBoundary extends Component<{ copy: string; retry: string; resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.empty}>
        <p>{this.props.copy}</p>
        <button type="button" className={styles.secondary} onClick={() => this.setState({ failed: false })}>{this.props.retry}</button>
      </div>
    );
  }
}

function MarketGone({ message }: { message: string }) {
  const app = useMiniApp();
  return (
    <div className={styles.empty}>
      <p>{message}</p>
      <button type="button" className={styles.secondary} onClick={() => app.selectTab("markets")}>{app.copy.betsEmptyAction}</button>
    </div>
  );
}

/** A small "back to top" button once a list has scrolled a screen down. */
function ScrollTop() {
  const { copy } = useMiniApp();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > Math.max(480, window.innerHeight * 0.8));
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  if (!visible) return null;
  return (
    <button type="button" className={styles.scrollTop} aria-label={copy.toTop} onClick={() => { haptic("select"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
      <ArrowUp size={18} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

function MiniAppShell() {
  const { phase, copy, view, tab, market, marketError, tabBarVisible, toast } = useMiniApp();
  return (
    <main className={tabBarVisible ? `${styles.app} ${styles.appWithTabs}` : styles.app}>
      {phase === "outside" ? <OutsidePage /> : null}
      {phase === "auth-error" ? <p className={styles.notice}>{copy.authFailed}</p> : null}
      {phase === "boot" ? <div className={styles.loading} aria-busy="true"><span className={styles.spinner} />{copy.loadingApp}</div> : null}

      {phase === "ready" && view === "" ? (
        <ScreenBoundary copy={copy.screenFailed} retry={copy.retry} resetKey={tab}>
          {tab === "markets" ? <MarketsTab /> : tab === "bets" ? <MyBetsTab /> : <WalletTab />}
        </ScreenBoundary>
      ) : null}

      {phase === "ready" && view === "bet" ? (
        market ? <BetSheet key={market.id} market={market} />
          : marketError ? <MarketGone message={marketError} />
            : <div className={styles.loading} aria-busy="true"><span className={styles.spinner} />{copy.loadingMarket}</div>
      ) : null}
      {phase === "ready" && view === "success" ? <SuccessScreen /> : null}
      {phase === "ready" && (view === "topup" || view === "withdraw") ? <FundingScreen mode={view} /> : null}
      {phase === "ready" && view === "key" ? <KeyScreen /> : null}
      {phase === "ready" && view === "connect" ? <ConnectScreen /> : null}

      {phase === "ready" && view === "" ? <ScrollTop /> : null}
      {tabBarVisible ? <TabBar /> : null}
      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </main>
  );
}
