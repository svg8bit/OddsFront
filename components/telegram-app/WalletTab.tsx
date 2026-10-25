"use client";

import { Check, ChevronRight, Copy, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { haptic } from "@/lib/telegram-app/client/webapp";
import { floorUsd, shortAddress } from "./format";
import { useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/** Balance, the deposit address, top-up / withdraw / key — the money itself moves only through FundingPanel. */

const ODDSFRONT_MAP = "https://oddsfront.com";

export function WalletTab() {
  const app = useMiniApp();
  const { copy, balance, wallet, winnings, collecting, key, needsRestore } = app;
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const address = wallet?.depositWallet || "";

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      haptic("success");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Older WebViews refuse the clipboard; the full address stays selectable in the funding screen.
    }
  };

  const refresh = async () => {
    haptic("select");
    setRefreshing(true);
    try {
      await app.refreshBalance();
    } finally {
      window.setTimeout(() => setRefreshing(false), 400);
    }
  };

  const collect = async () => {
    setError("");
    const failure = await app.collectWinnings();
    if (failure) setError(failure);
  };

  return (
    <section className={styles.screen}>
      <header className={styles.screenHead}>
        <h1 className={styles.screenTitle}>{copy.walletTitle}</h1>
      </header>

      <div className={styles.walletCard}>
        <div className={styles.walletBalanceRow}>
          <span className={styles.walletBalanceLabel}>{copy.balance}</span>
          <button type="button" className={styles.iconButton} aria-label={copy.refresh} disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw size={16} className={refreshing ? styles.spinIcon : undefined} aria-hidden />
          </button>
        </div>
        <strong className={styles.walletBalance}>{balance === null ? "—" : floorUsd(balance)}</strong>
        <p className={styles.walletHint}>{wallet ? copy.walletHint : copy.walletNoAccount}</p>
        <div className={styles.walletActions}>
          <button type="button" className={styles.primary} onClick={() => { haptic("tap"); app.setNeedUsd(null); app.openView("topup"); }}>{copy.topUp}</button>
          <button type="button" className={styles.secondary} disabled={!(balance && balance >= 2)} onClick={() => { haptic("tap"); app.openView("withdraw"); }}>{copy.withdraw}</button>
        </div>
      </div>

      {winnings && winnings.usd > 0.009 ? (
        <div className={styles.winnings}>
          <span>{copy.winnings(floorUsd(winnings.usd))}</span>
          <button type="button" className={styles.winningsButton} disabled={collecting} onClick={() => void collect()}>
            {collecting ? copy.collecting : copy.collect}
          </button>
        </div>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.list}>
        {address ? (
          <button type="button" className={styles.listButton} onClick={() => void copyAddress()}>
            <span className={styles.listText}>
              <span className={styles.listLabel}>{copy.walletAddress}</span>
              <span className={styles.listValue}>{shortAddress(address)}</span>
            </span>
            <span className={styles.listTrail}>{copied ? <><Check size={16} aria-hidden />{copy.copied}</> : <><Copy size={16} aria-hidden />{copy.copy}</>}</span>
          </button>
        ) : null}
        {key || needsRestore ? (
          <button type="button" className={styles.listButton} onClick={() => { haptic("tap"); app.openView("key"); }}>
            <span className={styles.listText}>
              <span className={styles.listIcon}><KeyRound size={18} aria-hidden /></span>
              <span className={styles.listValue}>{needsRestore ? copy.restoreTitle : copy.keyButton}</span>
            </span>
            <span className={styles.listTrail}><ChevronRight size={18} aria-hidden /></span>
          </button>
        ) : null}
        <button type="button" className={styles.listButton} onClick={() => { haptic("tap"); app.openLink(ODDSFRONT_MAP); }}>
          <span className={styles.listText}>
            <span className={styles.listIcon}><ExternalLink size={18} aria-hidden /></span>
            <span className={styles.listValue}>{copy.openMap}</span>
          </span>
          <span className={styles.listTrail}>oddsfront.com</span>
        </button>
      </div>

      <p className={styles.fineprint}>{copy.account}</p>
    </section>
  );
}
