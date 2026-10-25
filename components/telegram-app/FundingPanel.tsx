"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TonConnectUI } from "@tonconnect/ui";
import { ODDSFRONT_MINI_APP_BOT_USERNAME } from "@/lib/telegram-app/init-data";
import type { TelegramTrader } from "@/lib/telegram-app/client/trader";
import { confirmInTelegram, haptic } from "@/lib/telegram-app/client/webapp";
import { localizeError, type MiniAppCopy } from "./copy";
import { formatUsd, shortAddress as short } from "./format";
import styles from "./mini-app.module.css";

/**
 * Money in and out of the Telegram account: TON from the player's Telegram wallet (TON Connect, swapped
 * by Relay), or the wallet's own Polymarket bridge addresses for USDT/USDC on other networks.
 */

type TonQuote = { messages: Array<{ address: string; amount: string; payload?: string }>; tonAmount: string | null };
type WithdrawQuote = { depositAddress: string; tonAmount: string | null };
type BridgeAddresses = { evm?: string; svm?: string; tron?: string; btc?: string };

const TOP_UP_AMOUNTS = [5, 10, 25, 50];
/** Mirrors lib/telegram-app/relay-ton.ts: top-ups start at $3, withdrawals at $2. */
const TOP_UP_MIN_USD = 3;
const WITHDRAW_MIN_USD = 2;
const FUNDS_POLL_MS = 3_000;
const FUNDS_WAIT_MS = 3 * 60_000;

let tonConnect: Promise<TonConnectUI> | null = null;

function loadTonConnect(language: "ru" | "en") {
  tonConnect ??= import("@tonconnect/ui").then(({ TonConnectUI }) => new TonConnectUI({
    manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
    language,
    // Where an external wallet app (Tonkeeper) sends the player back after confirming.
    actionsConfiguration: { twaReturnUrl: `https://t.me/${ODDSFRONT_MINI_APP_BOT_USERNAME}?startapp` as `${string}://${string}` },
  }));
  return tonConnect;
}

async function friendlyAddress(raw: string) {
  const { toUserFriendlyAddress } = await import("@tonconnect/ui");
  return toUserFriendlyAddress(raw);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

export function FundingPanel({
  copy,
  mode,
  suggestedUsd,
  balance,
  prepare,
  onBalance,
  onFunded,
}: {
  copy: MiniAppCopy;
  mode: "topup" | "withdraw";
  suggestedUsd: number | null;
  balance: number | null;
  /** Creates the Telegram account (deploys the deposit wallet) and returns its trader. */
  prepare: () => Promise<TelegramTrader>;
  onBalance: (value: number | null) => void;
  onFunded: () => void;
}) {
  const [tonAddress, setTonAddress] = useState("");
  const [amount, setAmount] = useState(() => (mode === "withdraw" && balance !== null && balance < 10
    ? Math.max(WITHDRAW_MIN_USD, Math.floor(balance * 100) / 100)
    : Math.max(suggestedUsd ? Math.ceil(suggestedUsd) : 10, TOP_UP_MIN_USD)));
  // Each quote remembers what it priced, so a stale one never shows next to a new amount.
  const [priced, setPriced] = useState<{ key: string; ton: string | null } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<BridgeAddresses | null>(null);
  const [copied, setCopied] = useState("");
  const alive = useRef(true);
  const language = copy.lang;
  const minimum = mode === "topup" ? TOP_UP_MIN_USD : WITHDRAW_MIN_USD;

  useEffect(() => () => {
    alive.current = false;
  }, []);

  // Restore or follow the TON Connect wallet.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void loadTonConnect(language).then(async (ui) => {
      await ui.connectionRestored.catch(() => false);
      const update = async () => {
        const raw = ui.account?.address || "";
        const next = raw ? await friendlyAddress(raw).catch(() => "") : "";
        if (alive.current) setTonAddress(next);
      };
      unsubscribe = ui.onStatusChange(() => void update());
      await update();
    }).catch(() => undefined);
    return () => unsubscribe?.();
  }, [language]);

  // Live "≈ X TON" for the chosen amount.
  const quoteKey = `${mode}:${tonAddress}:${amount}`;
  const quote = priced?.key === quoteKey ? priced.ton : null;
  useEffect(() => {
    if (!tonAddress || !(amount >= minimum)) return undefined;
    const key = `${mode}:${tonAddress}:${amount}`;
    const timer = window.setTimeout(() => {
      void postJson<{ quote: TonQuote | WithdrawQuote }>("/api/tg/ton", { action: mode, tonAddress, amountUsd: amount })
        .then(({ quote: next }) => {
          if (alive.current) setPriced({ key, ton: next.tonAmount ? Number(next.tonAmount).toFixed(2) : null });
        })
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [amount, minimum, mode, tonAddress]);

  // The wallet's own deposit addresses (Polymarket bridge) for every other network.
  useEffect(() => {
    if (mode !== "topup") return;
    let cancelled = false;
    void (async () => {
      try {
        const trader = await prepare();
        const json = await postJson<{ deposit?: { address?: BridgeAddresses } }>("/api/tg/funding", { address: trader.depositWallet });
        if (!cancelled) setAddresses(json.deposit?.address || {});
      } catch {
        if (!cancelled) setAddresses({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, prepare]);

  const connect = useCallback(async () => {
    setError("");
    haptic("tap");
    const ui = await loadTonConnect(language);
    await ui.openModal();
  }, [language]);

  const disconnect = useCallback(async () => {
    const ui = await loadTonConnect(language);
    await ui.disconnect().catch(() => undefined);
    setTonAddress("");
  }, [language]);

  const waitForFunds = useCallback(async (trader: TelegramTrader, before: number) => {
    const deadline = Date.now() + FUNDS_WAIT_MS;
    while (alive.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, FUNDS_POLL_MS));
      const next = await trader.balance();
      if (next !== null) onBalance(next);
      if (next !== null && next > before + 0.5) return true;
    }
    return false;
  }, [onBalance]);

  const topUp = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const trader = await prepare();
      const before = (await trader.balance()) ?? 0;
      const { quote: fresh } = await postJson<{ quote: TonQuote }>("/api/tg/ton", { action: "topup", tonAddress, amountUsd: amount });
      setStatus(copy.confirmInWallet);
      const ui = await loadTonConnect(language);
      await ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: fresh.messages.map((message) => ({ address: message.address, amount: message.amount, ...(message.payload ? { payload: message.payload } : {}) })),
      });
      setStatus(copy.waitingFunds);
      if (await waitForFunds(trader, before)) {
        haptic("success");
        setStatus(copy.funded);
        onFunded();
      }
    } catch (caught) {
      haptic("error");
      setStatus("");
      const message = caught instanceof Error ? caught.message : "";
      // Closing the wallet sheet is not an error worth shouting about.
      if (!/reject|declin|cancel|abort/i.test(message)) setError(localizeError(copy, message || "Top-up failed. Try again."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [amount, copy, language, onFunded, prepare, tonAddress, waitForFunds]);

  const withdraw = useCallback(async () => {
    setError("");
    if (balance !== null && amount > balance) {
      setError(copy.balance + ": " + formatUsd(balance));
      return;
    }
    setBusy(true);
    try {
      const trader = await prepare();
      const { quote: fresh } = await postJson<{ quote: WithdrawQuote }>("/api/tg/ton", { action: "withdraw", tonAddress, amountUsd: amount });
      const ton = fresh.tonAmount ? Number(fresh.tonAmount).toFixed(2) : "?";
      if (!(await confirmInTelegram(copy.withdrawConfirm(formatUsd(amount), ton)))) return;
      await trader.sendPusd(fresh.depositAddress, amount);
      haptic("success");
      setStatus(copy.withdrawSent);
      onBalance(await trader.balance());
    } catch (caught) {
      haptic("error");
      setError(localizeError(copy, caught instanceof Error ? caught.message : "Withdrawal failed. Try again."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [amount, balance, copy, onBalance, prepare, tonAddress]);

  const copyAddress = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      haptic("select");
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  }, []);

  const amounts = mode === "topup"
    ? Array.from(new Set([...(suggestedUsd ? [Math.max(TOP_UP_MIN_USD, Math.ceil(suggestedUsd))] : []), ...TOP_UP_AMOUNTS])).sort((a, b) => a - b).slice(0, 4)
    : [5, 10, 25].filter((value) => balance === null || value <= balance);

  const networks: Array<{ label: string; value?: string }> = [
    { label: "USDT · TRON", value: addresses?.tron },
    { label: "USDC / USDT · Ethereum, Base, Arbitrum, BNB, Polygon", value: addresses?.evm },
    { label: "USDC · Solana", value: addresses?.svm },
    { label: "Bitcoin", value: addresses?.btc },
  ];

  return (
    <div className={styles.funding}>
      <section className={styles.fundingCard}>
        <div className={styles.fundingHead}>
          <span className={styles.tonMark} aria-hidden>◆</span>
          <div>
            <h2 className={styles.fundingTitle}>{mode === "topup" ? copy.fromTelegramWallet : copy.withdrawTitle}</h2>
            <p className={styles.fundingHint}>{mode === "topup" ? copy.fromTelegramWalletHint : copy.withdrawHint}</p>
          </div>
        </div>

        {tonAddress ? (
          <>
            <div className={styles.walletRow}>
              <span>{copy.connected(short(tonAddress))}</span>
              <button type="button" className={styles.linkButton} onClick={() => void disconnect()}>{copy.disconnect}</button>
            </div>
            <div className={styles.chips} role="group" aria-label={copy.amount}>
              {amounts.map((value) => (
                <button key={value} type="button" className={value === amount ? styles.chipActive : styles.chip} onClick={() => { haptic("select"); setAmount(value); }}>
                  {formatUsd(value)}
                </button>
              ))}
              {mode === "withdraw" && balance !== null && balance >= WITHDRAW_MIN_USD ? (
                <button type="button" className={amount === Math.floor(balance * 100) / 100 ? styles.chipActive : styles.chip} onClick={() => setAmount(Math.floor(balance * 100) / 100)}>
                  {copy.max}
                </button>
              ) : null}
            </div>
            <button type="button" className={styles.primary} disabled={busy || !(amount >= minimum)} onClick={() => void (mode === "topup" ? topUp() : withdraw())}>
              <span>{mode === "topup" ? copy.topUpButton(formatUsd(amount)) : copy.withdrawButton(formatUsd(amount))}</span>
              {quote ? <span className={styles.primaryNote}>{copy.quote(quote)}</span> : null}
            </button>
          </>
        ) : (
          <button type="button" className={styles.primary} onClick={() => void connect()}>
            <span>{copy.connectWallet}</span>
          </button>
        )}
        {status ? <p className={styles.status} role="status">{status}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      {mode === "topup" ? (
        <section className={styles.fundingCard}>
          <h2 className={styles.fundingTitle}>{copy.otherNetworks}</h2>
          <p className={styles.fundingHint}>{copy.otherNetworksHint}</p>
          <ul className={styles.addressList}>
            {networks.filter((network) => network.value || addresses === null).map((network) => (
              <li key={network.label} className={styles.addressRow}>
                <div className={styles.addressText}>
                  <span className={styles.addressLabel}>{network.label}</span>
                  <span className={styles.addressValue}>{network.value ? short(network.value) : "…"}</span>
                </div>
                {network.value ? (
                  <button type="button" className={styles.copyButton} onClick={() => void copyAddress(network.label, network.value as string)}>
                    {copied === network.label ? copy.copied : copy.copy}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
