"use client";

import { useEffect, useState } from "react";
import type { BinaryMarket } from "@/lib/telegram-app/markets";
import { haptic } from "@/lib/telegram-app/client/webapp";
import { BrandMark } from "./MiniApp";
import { formatChance, formatCompactUsd, formatEndDate, formatMove } from "./format";
import { useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/** The hottest geopolitics and politics markets; a card opens the bet sheet, its buttons pick Yes or No. */

const PAGE = 20;

export function MarketImage({ src, size }: { src: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={styles.marketImageEmpty} style={{ width: size, height: size }} aria-hidden><BrandMark size={Math.round(size * 0.5)} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.marketImage} src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}

function Skeleton() {
  return (
    <div className={styles.skeletonList} aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className={styles.skeletonCard}>
          <span className={styles.skeletonLine} style={{ width: "72%" }} />
          <span className={styles.skeletonLine} style={{ width: "48%" }} />
        </div>
      ))}
    </div>
  );
}

function MarketCard({ market }: { market: BinaryMarket }) {
  const app = useMiniApp();
  const { copy } = app;
  const move = formatMove(market.change24h);
  const end = formatEndDate(market.endDate, copy.lang);
  const event = market.eventTitle && market.eventTitle !== market.question ? market.eventTitle : null;
  const open = (side: 0 | 1) => {
    haptic("tap");
    app.openMarket(market.id, side, market);
  };
  return (
    <article className={styles.marketCard}>
      <button type="button" className={styles.marketTop} onClick={() => open(0)}>
        <MarketImage src={market.image} size={44} />
        <span className={styles.marketText}>
          {event ? <span className={styles.marketEvent}>{event}</span> : null}
          <span className={styles.marketQuestion}>{market.question}</span>
        </span>
        <span className={styles.marketChance}>
          <strong>{formatChance(market.yes.price)}</strong>
          {move ? <span className={move.up ? styles.moveUp : styles.moveDown}>{move.text}</span> : <span className={styles.chanceLabel}>{copy.chance}</span>}
        </span>
      </button>
      <div className={styles.marketActions}>
        <button type="button" className={styles.quickYes} onClick={() => open(0)}>{copy.yes} · {formatChance(market.yes.buyPrice ?? market.yes.price)}</button>
        <button type="button" className={styles.quickNo} onClick={() => open(1)}>{copy.no} · {formatChance(market.no.buyPrice ?? market.no.price)}</button>
      </div>
      <p className={styles.marketMeta}>
        {copy.volume24h(formatCompactUsd(market.volume24h))}
        {end ? <> · {copy.endsBy(end)}</> : null}
      </p>
    </article>
  );
}

export function MarketsTab() {
  const { copy, markets, marketsError, loadMarkets } = useMiniApp();
  const [mode, setMode] = useState<"hot" | "movers">("hot");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  const list = markets ? (mode === "hot" ? markets.hot : markets.movers) : null;

  return (
    <section className={styles.screen}>
      <header className={styles.screenHead}>
        <div className={styles.brand}><BrandMark /> <span className={styles.brandName}>OddsFront</span></div>
        <p className={styles.screenHint}>{copy.marketsHint}</p>
      </header>

      <div className={styles.segmented} role="tablist" aria-label={copy.marketsTitle}>
        {(["hot", "movers"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? styles.segmentActive : styles.segment}
            onClick={() => { haptic("select"); setMode(id); setShown(PAGE); }}
          >
            {id === "hot" ? copy.chipHot : copy.chipMovers}
          </button>
        ))}
      </div>

      {list === null && !marketsError ? <Skeleton /> : null}
      {list === null && marketsError ? (
        <div className={styles.empty}>
          <p>{copy.marketsFailed}</p>
          <button type="button" className={styles.secondary} onClick={() => void loadMarkets(true)}>{copy.retry}</button>
        </div>
      ) : null}
      {list && !list.length ? <p className={styles.empty}>{copy.marketsEmpty}</p> : null}
      {list && list.length ? (
        <div className={styles.marketList}>
          {list.slice(0, shown).map((market) => <MarketCard key={market.id} market={market} />)}
          {list.length > shown ? <button type="button" className={styles.secondary} onClick={() => setShown((value) => value + PAGE)}>{copy.showMore}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
