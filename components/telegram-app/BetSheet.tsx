"use client";

import { ArrowUpRight, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ODDSFRONT_MINI_APP_BOT_USERNAME } from "@/lib/telegram-app/init-data";
import { sharePrice, startParamFor, type BinaryMarket } from "@/lib/telegram-app/markets";
import { MIN_BET_USD } from "@/lib/telegram-app/client/trader";
import { haptic, telegramWebApp } from "@/lib/telegram-app/client/webapp";
import { buildPolymarketEventUrl } from "@/lib/polymarket-links";
import { localizeError, type MiniAppCopy } from "./copy";
import { floorUsd, formatChance, formatEndDate, formatMove, formatOdds, formatUsd } from "./format";
import { MarketImage } from "./MarketsTab";
import { readJson, useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/**
 * The bet sheet: the market, Yes or No, an amount and one button that always says what happens next —
 * connect a wallet, top up the missing amount, or place the bet. Orders carry the builder code
 * (the provider's trader); the Polymarket link carries the referral code, as on the map.
 */

const BET_AMOUNTS = [1, 5, 10, 25];
const MIN_TOP_UP_USD = 3;
/** The builder fee the CLOB adds on top of a taker order (100 bps): a $1 bet needs $1.01. */
const BUILDER_TAKER_FEE = 0.01;

/** What a bet of `amount` takes from the balance, fee included, rounded up to the cent. */
export function betCost(amount: number) {
  return Math.ceil(amount * (1 + BUILDER_TAKER_FEE) * 100 - 1e-6) / 100;
}

export function marketQuestion(market: Pick<BinaryMarket, "question" | "questionRu">, copy: MiniAppCopy) {
  return copy.lang === "ru" && market.questionRu ? market.questionRu : market.question;
}

/** The Yes chance over the market's life as a soft area chart (no axes: the number above tells the level). */
function ChanceChart({ token, up }: { token: string; up: boolean | null }) {
  const [points, setPoints] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/tg/history?token=${token}`).then((response) => readJson<{ points?: number[] }>(response)).then((json) => {
      if (alive) setPoints(Array.isArray(json.points) ? json.points : []);
    }).catch(() => {
      if (alive) setPoints([]);
    });
    return () => { alive = false; };
  }, [token]);
  if (!points || points.length < 6) return <div className={styles.chartEmpty} aria-hidden />;
  const width = 320;
  const height = 72;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(0.02, max - min);
  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => height - 6 - ((value - min) / span) * (height - 12);
  const line = points.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const tone = up === false ? "#d4625f" : up ? "#3fae6c" : "#c9ced6";
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="of-chance" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity="0.28" />
          <stop offset="1" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill="url(#of-chance)" />
      <path d={line} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BetSheet({ market }: { market: BinaryMarket }) {
  const app = useMiniApp();
  const { copy, balance, config, busy, setupStep, winnings, collecting, prepare, setBalance, side, setSide, needsRestore, hasAccount, storageMissing } = app;
  const [amountText, setAmountText] = useState("5");
  const [error, setError] = useState("");
  const parsed = Number(amountText);
  const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;

  const outcome = side === 0 ? market.yes : market.no;
  const price = sharePrice(market, side);
  const payout = price ? amount / price : null;
  const sideLabel = side === 0 ? copy.yes : copy.no;
  const move = formatMove(market.change24h);
  const polymarketUrl = buildPolymarketEventUrl(market.eventSlug || market.slug);
  const cost = betCost(amount);
  const shortfall = balance === null ? null : Math.max(0, Math.round((cost - balance) * 100) / 100);
  const end = formatEndDate(market.endDate, copy.lang);

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
      if (available !== null && available + 0.0001 < cost) {
        app.setNeedUsd(cost - available);
        app.openView("topup");
        return;
      }
      const placed = await trader.buy(outcome.assetId, amount);
      haptic("success");
      const spent = placed.spentUsd ?? amount;
      app.setReceipt({ marketId: market.id, side, question: marketQuestion(market, copy), amount: spent, payout: placed.shares ?? (price ? spent / price : null) });
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
  }, [amount, app, copy, cost, market, outcome.assetId, prepare, price, setBalance, side]);

  const collect = useCallback(async () => {
    setError("");
    const failure = await app.collectWinnings();
    if (failure) setError(failure);
  }, [app]);

  const busyLabel = busy === "bet" && !setupStep ? copy.placing : setupStep === "approvals" ? copy.approving : busy ? copy.settingUp : "";

  // One button, always the next step: connect → top up the missing amount → bet.
  let action: { label: string; tone: "brand" | "yes" | "no"; disabled?: boolean; run: () => void };
  if (storageMissing) action = { label: copy.noStorage, tone: "brand", disabled: true, run: () => undefined };
  else if (needsRestore) action = { label: copy.restoreButton, tone: "brand", run: () => app.openView("key") };
  else if (!hasAccount) action = { label: copy.connectAccount, tone: "brand", run: () => { haptic("tap"); app.setNeedUsd(Math.max(MIN_TOP_UP_USD, amount)); app.openView("connect"); } };
  else if (shortfall === null) action = { label: copy.checkingBalance, tone: "brand", disabled: true, run: () => undefined };
  else if (shortfall > 0.0001) {
    const topUp = Math.max(MIN_TOP_UP_USD, Math.ceil(shortfall));
    action = { label: copy.topUpTo(formatUsd(topUp)), tone: "brand", run: () => { haptic("tap"); app.setNeedUsd(shortfall); app.openView("topup"); } };
  } else action = { label: copy.place(formatUsd(amount), sideLabel), tone: side === 0 ? "yes" : "no", run: () => void placeBet() };

  return (
    <section className={styles.betLayout}>
      <header className={styles.sheetHead}>
        <MarketImage src={market.image} size={40} />
        <div className={styles.sheetHeadText}>
          {/* The source line is the Polymarket link (our referral code), as on the map. */}
          <button type="button" className={styles.sourceLink} disabled={!polymarketUrl} onClick={() => { if (polymarketUrl) { haptic("select"); app.openLink(polymarketUrl); } }}>
            Polymarket{polymarketUrl ? <ArrowUpRight size={13} aria-hidden /> : null}{end ? <span className={styles.sourceMeta}>· {copy.endsBy(end)}</span> : null}
          </button>
          <h1 className={styles.sheetQuestion}>{marketQuestion(market, copy)}</h1>
        </div>
      </header>

      <div className={styles.chanceCard}>
        <div className={styles.chanceRow}>
          <span className={styles.chanceValue}>{formatChance(market.yes.price)}<small>{copy.chanceOfYes}</small></span>
          {move ? <span className={move.up ? styles.pillUp : styles.pillDown}>{move.text} {copy.inDay}</span> : <span className={styles.chanceMeta}>{copy.chartWeek}</span>}
        </div>
        <ChanceChart token={market.yes.assetId} up={move ? move.up : null} />
      </div>

      <div className={styles.sides} role="radiogroup" aria-label={marketQuestion(market, copy)}>
        {([0, 1] as const).map((value) => {
          const selected = value === side;
          const sidePrice = sharePrice(market, value);
          const className = value === 0 ? (selected ? styles.sideYesActive : styles.sideYes) : (selected ? styles.sideNoActive : styles.sideNo);
          return (
            <button key={value} type="button" role="radio" aria-checked={selected} className={className} disabled={!market.open}
              onClick={() => { haptic("select"); setSide(value); }}>
              <span className={styles.sideLabel}>{value === 0 ? copy.yes : copy.no}</span>
              <span className={styles.sideChance}>{formatChance(sidePrice)}</span>
              <span className={styles.sideOdds}>{copy.odds} {formatOdds(sidePrice)}</span>
            </button>
          );
        })}
      </div>

      {/* The action dock sits at the bottom, above the tab bar: the next step is always under the thumb. */}
      <div className={styles.actionDock}>
        {market.open ? (
          <>
            <div className={styles.amountCard}>
              <label className={styles.amountField}>
                <span aria-hidden>$</span>
                <input aria-label={copy.amount} inputMode="decimal" placeholder="0" value={amountText}
                  onChange={(input) => setAmountText(input.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 7))} />
              </label>
              <div className={styles.quickAmounts} role="group" aria-label={copy.amount}>
                {BET_AMOUNTS.map((value) => (
                  <button key={value} type="button" className={value === amount ? styles.chipActive : styles.chip} onClick={() => { haptic("select"); setAmountText(String(value)); }}>
                    {formatUsd(value)}
                  </button>
                ))}
              </div>
              <div className={styles.summary}>
                <span>{copy.payout}</span>
                <strong>{payout ? floorUsd(payout) : "—"}</strong>
              </div>
            </div>

            {/* Everything the player needs to know lives inside the one button: the step, the shortfall, an error. */}
            <button type="button" className={error ? styles.primaryError : action.tone === "yes" ? styles.primaryYes : action.tone === "no" ? styles.primaryNo : styles.primary}
              disabled={Boolean(busy) || action.disabled || !config || amount <= 0 || (action.tone !== "brand" && !price)} onClick={() => { setError(""); action.run(); }}>
              {busy ? <span className={styles.buttonRow}><span className={styles.spinnerLight} />{busyLabel}</span> : (
                <>
                  <span>{action.label}</span>
                  {error ? <span className={styles.primaryNote} role="alert">{error}</span>
                    : hasAccount && shortfall !== null && shortfall > 0.0001 ? <span className={styles.primaryNote}>{copy.needMore(formatUsd(shortfall))}</span>
                      : null}
                </>
              )}
            </button>
          </>
        ) : (
          <p className={styles.notice}>{copy.closed}</p>
        )}

        {winnings && winnings.usd > 0.009 ? (
          <div className={styles.winnings}>
            <span>{copy.winnings(floorUsd(winnings.usd))}</span>
            <button type="button" className={styles.winningsButton} disabled={collecting} onClick={() => void collect()}>{collecting ? copy.collecting : copy.collect}</button>
          </div>
        ) : null}

        <footer className={styles.footer}>
          <span>{copy.balance} <strong>{balance === null ? "—" : floorUsd(balance)}</strong></span>
          <span className={styles.footerLinks}>
            {hasAccount ? <button type="button" className={styles.linkButton} onClick={() => { app.setNeedUsd(null); app.openView("topup"); }}>{copy.topUp}</button> : null}
          </span>
        </footer>
      </div>
    </section>
  );
}

/** The receipt after an accepted order, with a share link that opens the same bet for friends. */
export function SuccessScreen() {
  const app = useMiniApp();
  const { copy, receipt } = app;
  if (!receipt) return null;
  const sideLabel = receipt.side === 0 ? copy.yes : copy.no;
  const share = () => {
    const link = `https://t.me/${ODDSFRONT_MINI_APP_BOT_USERNAME}?startapp=${startParamFor(receipt.marketId, receipt.side)}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(copy.shareText(sideLabel, receipt.question))}`;
    const webApp = telegramWebApp();
    haptic("tap");
    if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
    else app.openLink(url);
  };
  return (
    <section className={styles.success} aria-live="polite">
      <div className={receipt.side === 0 ? styles.checkYes : styles.checkNo} aria-hidden>
        <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
      </div>
      <h1 className={styles.successTitle}>{copy.accepted}</h1>
      <p className={styles.receiptQuestion}>{receipt.question}</p>
      <div className={styles.receiptCard}>
        <div><span>{copy.stake}</span><strong>{copy.acceptedDetail(sideLabel, formatUsd(Math.round(receipt.amount * 100) / 100))}</strong></div>
        {receipt.payout ? <div><span>{copy.toWin}</span><strong className={styles.receiptWin}>{floorUsd(receipt.payout)}</strong></div> : null}
      </div>
      <div className={styles.successActions}>
        <button type="button" className={styles.primary} onClick={() => { if (app.fromChannel) telegramWebApp()?.close?.(); else app.selectTab("bets"); }}>
          {app.fromChannel ? copy.done : copy.tabBets}
        </button>
        <div className={styles.successRow}>
          <button type="button" className={styles.secondary} onClick={share}><Share2 size={17} aria-hidden />{copy.share}</button>
          <button type="button" className={styles.secondary} onClick={() => app.openView("bet")}>{copy.again}</button>
        </div>
      </div>
    </section>
  );
}
