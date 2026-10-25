"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { localizeError } from "./copy";
import { floorUsd, formatUsd, shortAddress } from "./format";
import { FundingPanel } from "./FundingPanel";
import { useMiniApp } from "./Provider";
import styles from "./mini-app.module.css";

/** Top-up and withdrawal, full height; Telegram's back arrow (or the link) returns where the player came from. */
export function FundingScreen({ mode }: { mode: "topup" | "withdraw" }) {
  const app = useMiniApp();
  const { copy, balance } = app;
  return (
    <section className={styles.sheet}>
      <header className={styles.subHeader}>
        <button type="button" className={styles.linkButton} onClick={app.goBack}>‹ {copy.back}</button>
        <span>{copy.balance} <strong>{balance === null ? "—" : floorUsd(balance)}</strong></span>
      </header>
      <h1 className={styles.title}>{mode === "topup" ? copy.topUpTitle : copy.withdraw}</h1>
      <FundingPanel
        copy={copy}
        mode={mode}
        suggestedUsd={mode === "topup" ? app.needUsd : null}
        balance={balance}
        prepare={app.prepare}
        onBalance={app.setBalance}
        onFunded={() => { app.setNeedUsd(null); app.goBack(); }}
      />
    </section>
  );
}

type StepState = "waiting" | "running" | "done" | "failed";

function Step({ index, state, title, hint, children }: { index: number; state: StepState; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <li className={styles.step} data-state={state}>
      <span className={styles.stepMark} aria-hidden>
        {state === "done" ? <Check size={15} strokeWidth={3} /> : state === "running" ? <span className={styles.spinner} /> : index}
      </span>
      <div className={styles.stepBody}>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.stepHint}>{hint}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * First-time setup as three steps: the Telegram account (key + Polymarket deposit wallet, created
 * here with visible progress and a retry, never an endless spinner), the top-up, then back to the bet.
 */
export function ConnectScreen() {
  const app = useMiniApp();
  const { copy, balance, hasAccount, setupStep, needUsd } = app;
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const started = useRef(false);
  const target = Math.max(1, needUsd ?? 1);
  const funded = hasAccount && balance !== null && balance + 0.0001 >= target;

  const setup = useCallback(async () => {
    setError("");
    setRunning(true);
    try {
      await app.prepare();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message !== copy.restoreTitle) setError(localizeError(copy, message || "Telegram wallet setup failed. Try again."));
    } finally {
      setRunning(false);
    }
  }, [app, copy]);

  // Step one starts by itself: opening this screen is the player's "connect".
  useEffect(() => {
    if (started.current || hasAccount) return undefined;
    started.current = true;
    const timer = window.setTimeout(() => void setup(), 0);
    return () => window.clearTimeout(timer);
  }, [hasAccount, setup]);

  const accountState: StepState = hasAccount && !running ? "done" : running ? "running" : error ? "failed" : "waiting";
  const fundState: StepState = funded ? "done" : hasAccount ? "running" : "waiting";

  return (
    <section className={styles.sheet}>
      <header className={styles.subHeader}>
        <button type="button" className={styles.linkButton} onClick={app.goBack}>‹ {copy.back}</button>
        <span>{copy.balance} <strong>{balance === null ? "—" : floorUsd(balance)}</strong></span>
      </header>
      <h1 className={styles.title}>{copy.connectTitle}</h1>
      <p className={styles.note}>{copy.connectHint}</p>

      <ol className={styles.steps}>
        <Step index={1} state={accountState} title={hasAccount ? copy.accountReady : copy.stepAccount}
          hint={running ? (setupStep === "approvals" ? copy.approving : copy.settingUp) : hasAccount && app.wallet ? shortAddress(app.wallet.depositWallet) : copy.stepAccountHint}>
          {error ? (
            <>
              <p className={styles.error} role="alert">{error}</p>
              <button type="button" className={styles.secondary} onClick={() => void setup()}>{copy.retry}</button>
            </>
          ) : null}
        </Step>
        <Step index={2} state={fundState} title={copy.stepFund} hint={funded ? copy.fundedReady : copy.stepFundHint} />
        <Step index={3} state={funded ? "done" : "waiting"} title={copy.stepBet} hint={copy.stepBetHint} />
      </ol>

      {funded ? (
        <button type="button" className={styles.primary} onClick={() => { app.setNeedUsd(null); app.goBack(); }}>{copy.continueBet}</button>
      ) : hasAccount ? (
        <FundingPanel
          copy={copy}
          mode="topup"
          suggestedUsd={needUsd ? Math.max(needUsd - (balance ?? 0), 0) || needUsd : null}
          balance={balance}
          prepare={app.prepare}
          onBalance={app.setBalance}
          onFunded={() => app.showToast(copy.funded)}
        />
      ) : null}
      {needUsd ? <p className={styles.fineprint}>{copy.amount}: {formatUsd(Math.round(target * 100) / 100)}</p> : null}
    </section>
  );
}

/** The account key: shown on request, or pasted to continue an account created on another device. */
export function KeyScreen() {
  const app = useMiniApp();
  const { copy, needsRestore, wallet, key } = app;
  const [shownKey, setShownKey] = useState("");
  const [restoreInput, setRestoreInput] = useState("");
  const [error, setError] = useState("");

  const restore = async () => {
    setError("");
    const failure = await app.restoreKey(restoreInput);
    if (failure) setError(failure);
    else setRestoreInput("");
  };

  const reveal = async () => {
    const value = await app.revealKey();
    if (value) setShownKey(value);
  };

  return (
    <section className={styles.sheet}>
      <header className={styles.subHeader}>
        <button type="button" className={styles.linkButton} onClick={() => { setShownKey(""); app.goBack(); }}>‹ {copy.back}</button>
      </header>
      {needsRestore ? (
        <>
          <h1 className={styles.title}>{copy.restoreTitle}</h1>
          <p className={styles.note}>{copy.restoreHint}</p>
          <textarea className={styles.keyInput} rows={3} value={restoreInput} onChange={(input) => setRestoreInput(input.target.value)} autoComplete="off" spellCheck={false} />
          <button type="button" className={styles.primary} onClick={() => void restore()}>{copy.restoreButton}</button>
          <button type="button" className={styles.linkButton} onClick={() => void app.startNewAccount()}>{copy.restoreNew}</button>
        </>
      ) : (
        <>
          <h1 className={styles.title}>{copy.keyTitle}</h1>
          <p className={styles.note}>{copy.keyHint}</p>
          {shownKey ? (
            <code className={styles.keyValue}>{shownKey}</code>
          ) : (
            <button type="button" className={styles.secondary} disabled={!key} onClick={() => void reveal()}>{copy.showKey}</button>
          )}
        </>
      )}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.fineprint}>{copy.account}{wallet?.depositWallet ? ` · ${shortAddress(wallet.depositWallet)}` : ""}</p>
    </section>
  );
}
