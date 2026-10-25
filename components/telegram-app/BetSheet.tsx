"use client";

import { useCallback, useState } from "react";
import { sharePrice, type BinaryMarket } from "@/lib/telegram-app/markets";
import { MIN_BET_USD } from "@/lib/telegram-app/client/trader";
import { haptic, telegramWebApp } from "@/lib/telegram-app/client/webapp";
import { localizeError } from "./copy";
import { floorUsd, formatChance, formatEndDate, formatMove, formatOdds, formatUsd } from "./format";
import { MarketImage } from "./MarketsTab";
import { useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/**
 * The bet sheet: the market question, Yes or No, an amount and one button. Opened by a channel post's
 * button or a market card; the order goes through the provider's trader only.
 */

const BET_AMOUNTS = [1, 5, 10, 25];

export function BetSheet({ market }: { market: BinaryMarket }) {
  const app = useMiniApp();
  const { copy, balance, config, busy, setupStep, winnings, collecting, prepare, setBalance, side, setSide, key, needsRestore } = app;
  const [amountText, setAmountText] = useState("5");
  const [error, setError] = useState("");
  const parsed = Number(amountText);
  const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;

  const outcome = side === 0 ? market.yes : market.no;
  const price = sharePrice(market, side);
  const payout = price ? amount / price : null;
  const sideLabel = side === 0 ? copy.yes : copy.no;
  const move = formatMove(market.change24h, copy.lang);
  const end = formatEndDate(market.endDate, copy.lang);
  const event = market.eventTitle && market.eventTitle !== market.question ? market.eventTitle : null;

  const placeBet = useCallback(async () => {
    setError("");
    if (!(amount >= MIN_BET_USD)) {
      setError(copy.minBet);
      return;
    }
    haptic("tap");
    app.setBusy("bet");
    try {
      const trader = await prepare();
      const available = await trader.balance();
      if (available !== null) setBalance(available);
      if (available !== null && available + 0.0001 < amount) {
        app.setNeedUsd(amount - available);
        app.openView("topup");
        return;
      }
      const placed = await trader.buy(outcome.assetId, amount);
      haptic("success");
      const spent = placed.spentUsd ?? amount;
      app.setReceipt({ side, question: market.question, amount: spent, payout: placed.shares ?? (price ? spent / price : null) });
      app.openView("success");
      void trader.balance().then(setBalance);
      void app.loadBets();
    } catch (caught) {
      haptic("error");
      const message = caught instanceof Error ? caught.message : "";
      if (message !== copy.restoreTitle) setError(localizeError(copy, message || "The bet was not placed. Try again."));
    } finally {
      app.setBusy("");
    }
  }, [amount, app, copy, market.question, outcome.assetId, prepare, price, setBalance, side]);

  const collect = useCallback(async () => {
    setError("");
    const failure = await app.collectWinnings();
    if (failure) setError(failure);
  }, [app]);

  const busyLabel = busy === "bet" && !setupStep ? copy.placing : setupStep === "approvals" ? copy.approving : busy ? copy.settingUp : "";

  return (
    <section className={styles.sheet}>
      <header className={styles.sheetHead}>
        <MarketImage src={market.image} size={48} />
        <div className={styles.sheetHeadText}>
          <span className={styles.sheetEvent}>
            {event || "Polymarket"}
            {end ? <> · {copy.endsBy(end)}</> : null}
          </span>
          <h1 className={styles.sheetQuestion}>{market.question}</h1>
        </div>
      </header>

      <div className={styles.sheetStats}>
        <span className={styles.sheetChance}>{formatChance(market.yes.price)} <small>{copy.chance} «{copy.yes}»</small></span>
        {move ? <span className={move.up ? styles.moveUp : styles.moveDown}>{copy.change24h(move.text)}</span> : null}
      </div>

      <div className={styles.sides} role="radiogroup" aria-label={market.question}>
        {([0, 1] as const).map((value) => {
          const selected = value === side;
          const sidePrice = sharePrice(market, value);
          const className = value === 0 ? (selected ? styles.sideYesActive : styles.sideYes) : (selected ? styles.sideNoActive : styles.sideNo);
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={className}
              disabled={!market.open}
              onClick={() => { haptic("select"); setSide(value); }}
            >
              <span className={styles.sideLabel}>{value === 0 ? copy.yes : copy.no}</span>
              <span className={styles.sideChance}>{formatChance(sidePrice)}</span>
              <span className={styles.sideOdds}>{copy.odds} {formatOdds(sidePrice)}</span>
            </button>
          );
        })}
      </div>

      {market.open ? (
        <>
          {/* The amount field is the main control; the quick amounts just fill it in. */}
          <div className={styles.amountRow}>
            <label className={styles.amountField}>
              <span aria-hidden>$</span>
              <input
                aria-label={copy.amount}
                inputMode="decimal"
                placeholder="0"
                value={amountText}
                onChange={(input) => setAmountText(input.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 7))}
              />
            </label>
            <div className={styles.quickAmounts} role="group" aria-label={copy.amount}>
              {BET_AMOUNTS.map((value) => (
                <button key={value} type="button" className={value === amount ? styles.chipActive : styles.chip} onClick={() => { haptic("select"); setAmountText(String(value)); }}>
                  {formatUsd(value)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.summary}>
            <span>{copy.payout}</span>
            <strong>{payout ? floorUsd(payout) : "—"}</strong>
          </div>

          <button
            type="button"
            className={side === 0 ? styles.primaryYes : styles.primaryNo}
            disabled={Boolean(busy) || !price || !config || amount <= 0}
            onClick={() => void placeBet()}
          >
            {busy ? <><span className={styles.spinnerLight} />{busyLabel}</> : copy.place(formatUsd(amount), sideLabel)}
          </button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </>
      ) : (
        <p className={styles.notice}>{copy.closed}</p>
      )}

      {winnings && winnings.usd > 0.009 ? (
        <div className={styles.winnings}>
          <span>{copy.winnings(floorUsd(winnings.usd))}</span>
          <button type="button" className={styles.winningsButton} disabled={collecting} onClick={() => void collect()}>
            {collecting ? copy.collecting : copy.collect}
          </button>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span>{copy.balance}: <strong>{balance === null ? "—" : floorUsd(balance)}</strong></span>
        <span className={styles.footerLinks}>
          <button type="button" className={styles.linkButton} onClick={() => { app.setNeedUsd(null); app.openView("topup"); }}>{copy.topUp}</button>
          {balance && balance >= 2 ? <button type="button" className={styles.linkButton} onClick={() => app.openView("withdraw")}>{copy.withdraw}</button> : null}
          {key || needsRestore ? <button type="button" className={styles.linkButton} onClick={() => app.openView("key")}>{copy.settings}</button> : null}
        </span>
      </footer>
    </section>
  );
}

/** The receipt after an accepted order. */
export function SuccessScreen() {
  const app = useMiniApp();
  const { copy, receipt } = app;
  if (!receipt) return null;
  const sideLabel = receipt.side === 0 ? copy.yes : copy.no;
  return (
    <section className={styles.success} aria-live="polite">
      <div className={receipt.side === 0 ? styles.checkYes : styles.checkNo} aria-hidden>
        <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
      </div>
      <h1 className={styles.successTitle}>{copy.accepted}</h1>
      <p className={styles.receiptQuestion}>{receipt.question}</p>
      <p className={styles.receiptLine}>{copy.acceptedDetail(sideLabel, formatUsd(Math.round(receipt.amount * 100) / 100))}</p>
      {receipt.payout ? <p className={styles.receiptPayout}>{copy.toWin}: <strong>{floorUsd(receipt.payout)}</strong></p> : null}
      <div className={styles.successActions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            if (app.fromChannel) telegramWebApp()?.close?.();
            else app.selectTab("bets");
          }}
        >
          {app.fromChannel ? copy.done : copy.tabBets}
        </button>
        <button type="button" className={styles.secondary} onClick={() => app.openView("bet")}>{copy.again}</button>
      </div>
    </section>
  );
}
