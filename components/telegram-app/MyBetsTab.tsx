"use client";

import { useEffect, useState } from "react";
import type { Bet } from "@/lib/telegram-app/positions";
import { haptic } from "@/lib/telegram-app/client/webapp";
import type { MiniAppCopy } from "./copy";
import { floorUsd, formatChance, formatUsd } from "./format";
import { MarketImage } from "./MarketsTab";
import { useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/** The player's bets, read from the deposit wallet: in play, won (to collect), lost or closed. */

function statusLabel(bet: Bet, copy: MiniAppCopy) {
  return bet.status === "won" ? copy.statusWon : bet.status === "lost" ? copy.statusLost : bet.status === "closed" ? copy.statusClosed : copy.statusOpen;
}

function outcomeLabel(outcome: string, copy: MiniAppCopy) {
  return /^yes$/i.test(outcome) ? copy.yes : /^no$/i.test(outcome) ? copy.no : outcome;
}

function signedUsd(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatUsd(Math.abs(rounded))}`;
}

function Skeleton() {
  return (
    <div className={styles.skeletonList} aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className={styles.skeletonCard}>
          <span className={styles.skeletonLine} style={{ width: "64%" }} />
          <span className={styles.skeletonLine} style={{ width: "44%" }} />
        </div>
      ))}
    </div>
  );
}

export function MyBetsTab() {
  const app = useMiniApp();
  const { copy, bets, betsError, loadBets, wallet, winnings, collecting } = app;
  const [error, setError] = useState("");

  useEffect(() => {
    void loadBets();
  }, [loadBets, wallet?.depositWallet]);

  const collect = async (conditionIds?: string[]) => {
    setError("");
    const failure = await app.collectWinnings(conditionIds);
    if (failure) setError(failure);
  };

  return (
    <section className={styles.screen}>
      <header className={styles.screenHead}>
        <h1 className={styles.screenTitle}>{copy.betsTitle}</h1>
      </header>

      {winnings && winnings.usd > 0.009 ? (
        <button type="button" className={styles.primaryYes} disabled={collecting} onClick={() => void collect()}>
          {collecting ? copy.collecting : copy.collectAll(floorUsd(winnings.usd))}
        </button>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {bets === null && wallet ? <Skeleton /> : null}
      {betsError && !bets?.length ? (
        <div className={styles.empty}>
          <p>{copy.betsFailed}</p>
          <button type="button" className={styles.secondary} onClick={() => void loadBets()}>{copy.retry}</button>
        </div>
      ) : null}
      {(!wallet || (bets && !bets.length)) && !betsError ? (
        <div className={styles.empty}>
          <p>{copy.betsEmpty}</p>
          <button type="button" className={styles.secondary} onClick={() => { haptic("select"); app.selectTab("markets"); }}>{copy.betsEmptyAction}</button>
        </div>
      ) : null}

      {bets && bets.length ? (
        <div className={styles.betList}>
          {bets.map((bet) => {
            const yes = /^yes$/i.test(bet.outcome);
            return (
              <article key={bet.assetId} className={styles.betCard}>
                <div className={styles.betHead}>
                  <MarketImage src={bet.icon} size={36} />
                  <span className={styles.betTitle}>{bet.title || bet.slug}</span>
                  <span className={styles[`status_${bet.status}`]}>{statusLabel(bet, copy)}</span>
                </div>
                <div className={styles.betNumbers}>
                  <span className={yes ? styles.outcomeYes : styles.outcomeNo}>{outcomeLabel(bet.outcome, copy)}</span>
                  <span>{copy.stake}: <strong>{formatUsd(Math.round(bet.cost * 100) / 100)}</strong></span>
                  {bet.status === "open" ? <span>{copy.now}: <strong>{floorUsd(bet.value)}</strong> · {formatChance(bet.curPrice)}</span> : null}
                  {bet.status !== "open" && bet.pnl ? <span className={bet.pnl > 0 ? styles.moveUp : styles.moveDown}>{signedUsd(bet.pnl)}</span> : null}
                </div>
                {bet.redeemable ? (
                  <button type="button" className={styles.winningsButton} disabled={collecting} onClick={() => void collect([bet.conditionId])}>
                    {collecting ? copy.collecting : `${copy.collect} ${floorUsd(bet.value)}`}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
