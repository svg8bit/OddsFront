"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { MiniAppConfig } from "@/lib/telegram-app/config";
import { parseStartParam, type BinaryMarket } from "@/lib/telegram-app/markets";
import type { Bet } from "@/lib/telegram-app/positions";
import { createDeviceKey, deviceKeyStores, loadDeviceKey, parsePastedKey, pickDeviceKeyStore, saveDeviceKey, type DeviceKey, type DeviceKeyStore } from "@/lib/telegram-app/client/device-key";
import { TelegramTrader, type SetupStep } from "@/lib/telegram-app/client/trader";
import { cloudGet, cloudSet, confirmInTelegram, haptic, telegramWebApp, type TelegramWebApp } from "@/lib/telegram-app/client/webapp";
import { walletProofMessage } from "@/lib/telegram-app/wallet-proof";
import { localizeError, miniAppCopy, type MiniAppCopy } from "./copy";

/**
 * Everything the Mini App's screens share: the Telegram session, the player's account (owner key on
 * the phone + Polymarket deposit wallet + trader), the balance, the open market, and navigation (tabs
 * and nested views wired to Telegram's BackButton). Money moves only through `prepare()`'s trader
 * (bets, winnings) and the funding panel (top-ups and withdrawals).
 */

export type Phase = "boot" | "outside" | "auth-error" | "ready";
export type Tab = "markets" | "bets" | "wallet";
export type View = "" | "bet" | "success" | "topup" | "withdraw" | "key";
export type WalletInfo = { owner: string; depositWallet: string; deployed: boolean };
export type Receipt = { side: 0 | 1; question: string; amount: number; payout: number | null };
export type Winnings = { usd: number; conditionIds: string[] };
export type MarketsFeed = { generatedAt: string; hot: BinaryMarket[]; movers: BinaryMarket[] };

const CANVAS = "#0b1220";
const MARKET_REFRESH_MS = 10_000;
const MARKETS_FRESH_MS = 60_000;
const TOAST_MS = 2_400;
const CLOUD_OWNER_KEY = "of_owner";
const TABS: Tab[] = ["markets", "bets", "wallet"];

export async function readJson<T>(response: Response) {
  return await response.json().catch(() => ({})) as T & { error?: string };
}

type MiniApp = {
  phase: Phase;
  copy: MiniAppCopy;
  fromChannel: boolean;
  config: MiniAppConfig | null;
  key: DeviceKey | null;
  wallet: WalletInfo | null;
  needsRestore: boolean;
  balance: number | null;
  setBalance: (value: number | null) => void;
  refreshBalance: () => Promise<void>;
  winnings: Winnings | null;
  collecting: boolean;
  collectWinnings: (conditionIds?: string[]) => Promise<string>;
  busy: "" | "setup" | "bet";
  setBusy: (value: "" | "setup" | "bet" | ((current: "" | "setup" | "bet") => "" | "setup" | "bet")) => void;
  setupStep: SetupStep | null;
  prepare: () => Promise<TelegramTrader>;
  tab: Tab;
  selectTab: (tab: Tab) => void;
  view: View;
  openView: (view: View) => void;
  goBack: () => void;
  tabBarVisible: boolean;
  market: BinaryMarket | null;
  marketError: string;
  side: 0 | 1;
  setSide: (side: 0 | 1) => void;
  openMarket: (marketId: string, side: 0 | 1, preloaded?: BinaryMarket | null) => void;
  needUsd: number | null;
  setNeedUsd: (value: number | null) => void;
  receipt: Receipt | null;
  setReceipt: (value: Receipt | null) => void;
  restoreKey: (input: string) => Promise<string>;
  startNewAccount: () => Promise<void>;
  revealKey: () => Promise<string | null>;
  toast: string;
  showToast: (message: string) => void;
  markets: MarketsFeed | null;
  marketsError: boolean;
  loadMarkets: (force?: boolean) => Promise<void>;
  bets: Bet[] | null;
  betsError: boolean;
  loadBets: () => Promise<void>;
  openLink: (url: string) => void;
};

const MiniAppContext = createContext<MiniApp | null>(null);

export function useMiniApp() {
  const value = useContext(MiniAppContext);
  if (!value) throw new Error("useMiniApp outside MiniAppProvider");
  return value;
}

/** Run `task` right after the current effect pass (state updates belong in callbacks, not effect bodies). */
function later(task: () => void) {
  const timer = window.setTimeout(task, 0);
  return () => window.clearTimeout(timer);
}

function winningsOf(bets: Bet[]): Winnings {
  const won = bets.filter((bet) => bet.redeemable);
  return { usd: won.reduce((sum, bet) => sum + bet.value, 0), conditionIds: Array.from(new Set(won.map((bet) => bet.conditionId))) };
}

export function MiniAppProvider({ scriptReady, children }: { scriptReady: boolean; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [copy, setCopy] = useState<MiniAppCopy>(() => miniAppCopy("ru"));
  const [telegramUser, setTelegramUser] = useState("");
  const [betParam, setBetParam] = useState("");
  const [config, setConfig] = useState<MiniAppConfig | null>(null);
  const [store, setStore] = useState<DeviceKeyStore | null>(null);
  const [key, setKey] = useState<DeviceKey | null>(null);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [cloudOwner, setCloudOwner] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [betsError, setBetsError] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [busy, setBusy] = useState<"" | "setup" | "bet">("");
  const [setupStep, setSetupStep] = useState<SetupStep | null>(null);
  const [tab, setTab] = useState<Tab>("markets");
  const [view, setView] = useState<View>("");
  const [market, setMarket] = useState<BinaryMarket | null>(null);
  const [marketId, setMarketId] = useState("");
  const [marketError, setMarketError] = useState("");
  const [side, setSide] = useState<0 | 1>(0);
  const [needUsd, setNeedUsd] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [toast, setToast] = useState("");
  const [markets, setMarkets] = useState<MarketsFeed | null>(null);
  const [marketsError, setMarketsError] = useState(false);
  const traderRef = useRef<TelegramTrader | null>(null);
  const readyRef = useRef(false);
  const marketIdRef = useRef("");
  const returnViewRef = useRef<View>("");
  const toastTimer = useRef<number | null>(null);
  const marketsLoadedAt = useRef(0);

  // Outside Telegram the script never hands over initData: say so instead of spinning forever.
  useEffect(() => {
    const timer = window.setTimeout(() => setPhase((current) => (current === "boot" && !telegramWebApp() ? "outside" : current)), 6_000);
    return () => window.clearTimeout(timer);
  }, []);

  /** Telegram handed over the app: theme it, read the start parameter and sign in. */
  function boot(app: TelegramWebApp) {
    app.ready();
    app.setHeaderColor?.(CANVAS);
    app.setBackgroundColor?.(CANVAS);
    app.setBottomBarColor?.(CANVAS);
    setCopy(miniAppCopy(app.initDataUnsafe.user?.language_code));
    void pickDeviceKeyStore(deviceKeyStores(app)).then((picked) => {
      setStore(picked);
      if (!picked) setKeyLoaded(true);
    });
    const param = app.initDataUnsafe.start_param || new URLSearchParams(window.location.search).get("tgWebAppStartParam") || "";
    const isBet = Boolean(parseStartParam(param));
    setBetParam(isBet ? param : "");
    if (!isBet) {
      // The tabbed app wants the full height; a channel button keeps Telegram's compact sheet.
      app.expand?.();
      app.disableVerticalSwipes?.();
      if ((TABS as string[]).includes(param)) setTab(param as Tab);
    }

    void (async () => {
      const [session, runtime] = await Promise.all([
        fetch("/api/tg/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: app.initData }),
        }).catch(() => null),
        fetch("/api/tg/config", { cache: "no-store" }).then((response) => readJson<MiniAppConfig>(response)).catch(() => null),
      ]);
      const sessionJson = session ? await readJson<{ user?: { id?: string } }>(session) : null;
      if (!session?.ok || !sessionJson?.user?.id) {
        setPhase("auth-error");
        return;
      }
      setTelegramUser(sessionJson.user.id);
      if (runtime && typeof runtime.builderCode === "string") setConfig(runtime);
      setPhase("ready");
    })();
  }

  useEffect(() => {
    if (!scriptReady) return;
    const app = telegramWebApp();
    if (!app) return later(() => setPhase("outside"));
    return later(() => boot(app));
  }, [scriptReady]);

  useEffect(() => {
    if (!store) return;
    void loadDeviceKey(store).then((loaded) => {
      setKey(loaded);
      setKeyLoaded(true);
    });
  }, [store]);

  /** The phone proves it holds `deviceKey`; the session then serves that key's deposit wallet. */
  const proveKey = useCallback(async (deviceKey: DeviceKey) => {
    const issuedAt = new Date().toISOString();
    const message = walletProofMessage({ telegramUser, owner: deviceKey.address, issuedAt });
    const signature = await privateKeyToAccount(deviceKey.privateKey).signMessage({ message });
    const response = await fetch("/api/tg/wallet", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: deviceKey.address, issuedAt, signature }),
    });
    const json = await readJson<{ wallet?: WalletInfo }>(response);
    if (!response.ok || !json.wallet) throw new Error(json.error || "Telegram account is unavailable.");
    setWallet(json.wallet);
    return json.wallet;
  }, [telegramUser]);

  // A returning player's wallet (and balance) shows without any tap; a new phone looks for an account
  // the player created elsewhere (Telegram CloudStorage keeps only its public owner address).
  useEffect(() => {
    if (phase !== "ready" || !keyLoaded || !telegramUser) return;
    if (key) return later(() => void proveKey(key).catch(() => undefined));
    void cloudGet(CLOUD_OWNER_KEY).then((owner) => setCloudOwner(owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner : null));
  }, [key, keyLoaded, phase, proveKey, telegramUser]);

  const needsRestore = keyLoaded && !key && Boolean(cloudOwner);

  const loadBets = useCallback(async () => {
    const response = await fetch("/api/tg/positions", { credentials: "same-origin", cache: "no-store" }).catch(() => null);
    const json = response?.ok ? await readJson<{ bets?: Bet[] }>(response) : null;
    if (!json || !Array.isArray(json.bets)) {
      setBetsError(true);
      setBets((current) => current ?? []);
      return;
    }
    setBetsError(false);
    setBets(json.bets);
  }, []);

  // The balance shows before the wallet is deployed too: deposits can reach its address early.
  useEffect(() => {
    if (!config || !key || !wallet || wallet.owner.toLowerCase() !== key.address.toLowerCase()) return;
    if (traderRef.current?.depositWallet !== wallet.depositWallet) traderRef.current = new TelegramTrader(key, wallet.depositWallet, config);
    void traderRef.current.balance().then(setBalance);
    return later(() => void loadBets());
  }, [config, key, loadBets, wallet]);

  const refreshBalance = useCallback(async () => {
    const trader = traderRef.current;
    if (!trader) return;
    const [value] = await Promise.all([trader.balance(), loadBets()]);
    setBalance(value);
  }, [loadBets]);

  // --- The open market and its live price, refreshed while the sheet is open. ---

  const loadMarket = useCallback(async (id: string, initial: boolean) => {
    const response = await fetch(`/api/tg/market?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
    const json = response ? await readJson<{ market?: BinaryMarket }>(response) : null;
    if (marketIdRef.current !== id) return;
    if (!response?.ok || !json?.market) {
      if (initial) setMarketError(localizeError(copy, json?.error || "") || copy.closed);
      return;
    }
    setMarket(json.market);
  }, [copy]);

  const openMarket = useCallback((id: string, nextSide: 0 | 1, preloaded?: BinaryMarket | null) => {
    marketIdRef.current = id;
    setMarketId(id);
    setSide(nextSide);
    setMarket(preloaded ?? null);
    setMarketError("");
    setReceipt(null);
    setView("bet");
    window.scrollTo(0, 0);
    void loadMarket(id, !preloaded);
  }, [loadMarket]);

  useEffect(() => {
    if (phase !== "ready" || view !== "bet" || !marketId) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMarket(marketId, false);
    }, MARKET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadMarket, marketId, phase, view]);

  // A channel button's market opens straight away, with Yes or No already picked.
  useEffect(() => {
    if (phase !== "ready" || !betParam) return;
    const param = parseStartParam(betParam);
    if (param) return later(() => openMarket(param.marketId, param.side));
  }, [betParam, openMarket, phase]);

  // --- Navigation: tabs, nested views and Telegram's own back arrow. ---

  const nested = view === "topup" || view === "withdraw" || view === "key";
  const tabBarVisible = phase === "ready" && !nested;

  const selectTab = useCallback((next: Tab) => {
    haptic("select");
    setTab(next);
    setView("");
    window.scrollTo(0, 0);
  }, []);

  const openView = useCallback((next: View) => {
    setView((current) => {
      if (next === "topup" || next === "withdraw" || next === "key") returnViewRef.current = current === "bet" || current === "success" ? current : "";
      return next;
    });
    window.scrollTo(0, 0);
  }, []);

  const goBack = useCallback(() => {
    setView((current) => (current === "topup" || current === "withdraw" || current === "key" ? returnViewRef.current : ""));
    window.scrollTo(0, 0);
  }, []);

  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  }, [goBack]);

  useEffect(() => {
    const app = telegramWebApp();
    const back = app?.BackButton;
    if (!back) return undefined;
    const handler = () => goBackRef.current();
    if (view) {
      if (nested) app?.expand?.();
      back.show();
      back.onClick(handler);
    } else {
      back.hide();
    }
    return () => back.offClick(handler);
  }, [nested, view]);

  // --- The player's trader: creates the key and the deposit wallet on first use. ---

  const prepare = useCallback(async () => {
    if (!config) throw new Error(copy.loadingApp);
    if (!store) throw new Error(copy.noStorage);
    if (traderRef.current && readyRef.current) return traderRef.current;
    if (!key && cloudOwner) {
      // The account's key lives on another device: restore it instead of silently minting a second one.
      openView("key");
      throw new Error(copy.restoreTitle);
    }
    setBusy((current) => current || "setup");
    try {
      let deviceKey = key;
      if (!deviceKey) {
        deviceKey = await createDeviceKey(store);
        setKey(deviceKey);
        void cloudSet(CLOUD_OWNER_KEY, deviceKey.address);
      }
      const info = wallet && wallet.owner.toLowerCase() === deviceKey.address.toLowerCase() ? wallet : await proveKey(deviceKey);
      const trader = traderRef.current?.depositWallet === info.depositWallet ? traderRef.current : new TelegramTrader(deviceKey, info.depositWallet, config);
      traderRef.current = trader;
      await trader.ensureReady(setSetupStep);
      readyRef.current = true;
      if (!info.deployed) {
        const refreshed = await fetch("/api/tg/wallet", { credentials: "same-origin", cache: "no-store" })
          .then((response) => readJson<{ wallet?: WalletInfo }>(response)).catch(() => null);
        if (refreshed?.wallet) setWallet(refreshed.wallet);
      }
      void trader.balance().then(setBalance);
      return trader;
    } finally {
      setSetupStep(null);
      setBusy((current) => (current === "setup" ? "" : current));
    }
  }, [cloudOwner, config, copy, key, openView, proveKey, store, wallet]);

  const winnings = useMemo(() => (bets ? winningsOf(bets) : null), [bets]);

  /** Redeem settled winners (all of them by default) to the Telegram balance; returns an error message or "". */
  const collectWinnings = useCallback(async (conditionIds?: string[]) => {
    const chosen = conditionIds ?? winnings?.conditionIds ?? [];
    if (!chosen.length) return "";
    setCollecting(true);
    haptic("tap");
    try {
      const trader = await prepare();
      await trader.redeem(chosen.map((conditionId) => ({ conditionId })));
      haptic("success");
      const [value] = await Promise.all([trader.balance(), loadBets()]);
      setBalance(value);
      return "";
    } catch (caught) {
      haptic("error");
      const message = caught instanceof Error ? caught.message : "";
      return message === copy.restoreTitle ? "" : localizeError(copy, message || "Winnings were not collected. Try again.");
    } finally {
      setCollecting(false);
    }
  }, [copy, loadBets, prepare, winnings]);

  const restoreKey = useCallback(async (input: string) => {
    const pasted = parsePastedKey(input);
    if (!pasted || !store) return copy.restoreBadKey;
    const address = privateKeyToAccount(pasted).address;
    if (cloudOwner && address.toLowerCase() !== cloudOwner.toLowerCase()) return copy.restoreWrongKey;
    try {
      const saved = await saveDeviceKey(store, pasted);
      traderRef.current = null;
      readyRef.current = false;
      setKey(saved);
      await proveKey(saved);
      haptic("success");
      goBack();
      return "";
    } catch (caught) {
      return caught instanceof Error ? localizeError(copy, caught.message) : copy.restoreBadKey;
    }
  }, [cloudOwner, copy, goBack, proveKey, store]);

  /** A fresh empty account on this phone; the old one stays reachable with its key. */
  const startNewAccount = useCallback(async () => {
    if (!store || !(await confirmInTelegram(copy.restoreNewConfirm))) return;
    const created = await createDeviceKey(store);
    void cloudSet(CLOUD_OWNER_KEY, created.address);
    setCloudOwner(created.address);
    traderRef.current = null;
    readyRef.current = false;
    setKey(created);
    goBack();
  }, [copy, goBack, store]);

  const revealKey = useCallback(async () => {
    if (!key) return null;
    return (await confirmInTelegram(copy.showKeyConfirm)) ? key.privateKey : null;
  }, [copy, key]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);

  const loadMarkets = useCallback(async (force = false) => {
    if (!force && Date.now() - marketsLoadedAt.current < MARKETS_FRESH_MS) return;
    const response = await fetch("/api/tg/markets").catch(() => null);
    const json = response?.ok ? await readJson<MarketsFeed>(response) : null;
    if (!json || !Array.isArray(json.hot)) {
      setMarketsError(true);
      return;
    }
    marketsLoadedAt.current = Date.now();
    setMarketsError(false);
    setMarkets(json);
  }, []);

  const openLink = useCallback((url: string) => {
    const app = telegramWebApp();
    if (app?.openLink) app.openLink(url);
    else window.open(url, "_blank", "noopener");
  }, []);

  const value = useMemo<MiniApp>(() => ({
    phase, copy, fromChannel: Boolean(betParam), config, key, wallet, needsRestore,
    balance, setBalance, refreshBalance, winnings, collecting, collectWinnings,
    busy, setBusy, setupStep, prepare,
    tab, selectTab, view, openView, goBack, tabBarVisible,
    market, marketError, side, setSide, openMarket,
    needUsd, setNeedUsd, receipt, setReceipt,
    restoreKey, startNewAccount, revealKey, toast, showToast,
    markets, marketsError, loadMarkets, bets, betsError, loadBets, openLink,
  }), [
    phase, copy, betParam, config, key, wallet, needsRestore, balance, refreshBalance, winnings, collecting, collectWinnings,
    busy, setupStep, prepare, tab, selectTab, view, openView, goBack, tabBarVisible, market, marketError, side, openMarket,
    needUsd, receipt, restoreKey, startNewAccount, revealKey, toast, showToast, markets, marketsError, loadMarkets, bets, betsError, loadBets, openLink,
  ]);

  return <MiniAppContext.Provider value={value}>{children}</MiniAppContext.Provider>;
}
