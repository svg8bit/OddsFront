"use client";

import { useState } from "react";
import { floorUsd, shortAddress } from "./format";
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
        <span>{copy.balance}: <strong>{balance === null ? "—" : floorUsd(balance)}</strong></span>
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
