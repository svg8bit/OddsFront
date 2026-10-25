import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { parseBuilderSigningPayload, relayerSubmissionBelongsTo } from "./builder-signing.ts";
import { miniAppConfig, restrictedRegion } from "./config.ts";
import { deriveBeaconDepositWalletAddress, deriveLegacyDepositWalletAddress } from "./deposit-wallet.ts";
import { initDataConfig, verifyInitData } from "./init-data.ts";
import { hotMarketsFromEvents, isNewsMarket, parseGammaMarket, parseStartParam, sharePrice, startParamFor } from "./markets.ts";
import { betFromPosition, betsFromPositions } from "./positions.ts";
import { WindowLimiter } from "./rate-limit.ts";
import { decodeSession, encodeSession, readCookie, sessionCookieHeader } from "./session.ts";

const NOW = 1_790_000_000;
const USER = JSON.stringify({ id: 753260973, first_name: "Max", username: "max", language_code: "ru" });
const checkString = (fields: Record<string, string>) => Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join("\n");

function ed25519InitData(botId: string, fields: Record<string, string>) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(`${botId}:WebAppData\n${checkString(fields)}`), privateKey).toString("base64url");
  const raw = publicKey.export({ format: "jwk" }).x as string;
  return { initData: new URLSearchParams({ ...fields, signature, hash: "0".repeat(64) }).toString(), publicKeyHex: Buffer.from(raw, "base64url").toString("hex") };
}

function hmacInitData(botToken: string, fields: Record<string, string>) {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe("Telegram initData", () => {
  const fields = { auth_date: String(NOW - 30), query_id: "AAE", start_param: "m601826_0", user: USER };

  it("accepts Telegram's Ed25519 signature for the OddsFront bot with no secret", () => {
    const { initData, publicKeyHex } = ed25519InitData("8783764515", fields);
    const login = verifyInitData(initData, { botId: "8783764515", botToken: "", publicKeyHex }, NOW);
    assert.equal(login?.userId, "753260973");
    assert.equal(login?.startParam, "m601826_0");
    assert.equal(login?.languageCode, "ru");
  });

  it("rejects forged, other-bot and stale data", () => {
    const { initData, publicKeyHex } = ed25519InitData("8783764515", fields);
    const config = { botId: "8783764515", botToken: "", publicKeyHex };
    assert.equal(verifyInitData(initData.replace("Max", "Eve"), config, NOW), null);
    assert.equal(verifyInitData(initData, { ...config, botId: "8120327887" }, NOW), null);
    assert.equal(verifyInitData(initData, config, NOW + 2 * 24 * 60 * 60), null);
    assert.equal(verifyInitData(42, config, NOW), null);
  });

  it("uses the bot-token HMAC when a token is configured", () => {
    const config = { botId: "8783764515", botToken: "8783764515:test-token", publicKeyHex: "" };
    assert.equal(verifyInitData(hmacInitData(config.botToken, fields), config, NOW)?.userId, "753260973");
    assert.equal(verifyInitData(hmacInitData("8783764515:other", fields), config, NOW), null);
  });

  it("defaults to @DropsAnalyticsAIbot and Telegram's production key", () => {
    assert.equal(initDataConfig({})?.botId, "8783764515");
    assert.equal(initDataConfig({ ODDSFRONT_TG_BOT_ID: "123456" })?.botId, "123456");
    assert.equal(initDataConfig({ ODDSFRONT_TG_BOT_ID: "nope" }), null);
  });
});

describe("Mini App session cookie", () => {
  const secret = "s".repeat(40);
  const session = { user: "753260973", owner: "0x" + "a".repeat(40), wallet: "0x" + "b".repeat(40), expires: NOW + 600 };

  it("round-trips and rejects tampering or expiry", () => {
    const value = encodeSession(session, secret);
    assert.deepEqual(decodeSession(value, secret, NOW), session);
    const [payload, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "1", o: session.owner, w: session.wallet, e: NOW + 600 })).toString("base64url");
    assert.equal(decodeSession(`${forged}.${signature}`, secret, NOW), null);
    assert.equal(decodeSession(`${payload}.${signature}`, "t".repeat(40), NOW), null);
    assert.equal(decodeSession(value, secret, NOW + 601), null);
  });

  it("never keeps a wallet without its owner", () => {
    const value = encodeSession({ user: "1", wallet: session.wallet, expires: NOW + 60 }, secret);
    assert.deepEqual(decodeSession(value, secret, NOW), { user: "1", expires: NOW + 60 });
  });

  it("is a partitioned SameSite=None HttpOnly cookie Telegram Web accepts", () => {
    const header = sessionCookieHeader({ ...session, expires: Math.floor(Date.now() / 1000) + 600 }, secret);
    assert.match(header, /^of_tg_session=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=None; Partitioned$/);
    assert.equal(readCookie(`a=1; of_tg_session=abc.def; b=2`), "abc.def");
  });
});

describe("builder signing", () => {
  it("signs only the CLOB and relayer calls betting needs", () => {
    assert.equal(parseBuilderSigningPayload({ method: "POST", path: "/order", body: "{}" })?.scope, "clob");
    assert.equal(parseBuilderSigningPayload({ method: "POST", path: "/auth/api-key" })?.scope, "clob");
    assert.equal(parseBuilderSigningPayload({ method: "GET", path: "/deployed?address=0x1" })?.scope, "relayer-read");
    assert.equal(parseBuilderSigningPayload({ method: "POST", path: "/submit", body: "{}" })?.scope, "relayer-submit");
    assert.equal(parseBuilderSigningPayload({ method: "POST", path: "/v1/builder/rfq/requests", body: "{}" }), null);
    assert.equal(parseBuilderSigningPayload({ method: "GET", path: "https://evil/order" }), null);
    assert.equal(parseBuilderSigningPayload({ method: "DELETE", path: "/order" }), null);
  });

  it("lets a relayer submission through only from the session's owner key", () => {
    const owner = "0x" + "c".repeat(40);
    const payload = (from: string, type = "WALLET") => parseBuilderSigningPayload({ method: "POST", path: "/submit", body: JSON.stringify({ from, type }) })!;
    assert.equal(relayerSubmissionBelongsTo(payload(owner.toUpperCase().replace("0X", "0x")), owner), true);
    assert.equal(relayerSubmissionBelongsTo(payload(owner, "WALLET-CREATE"), owner), true);
    assert.equal(relayerSubmissionBelongsTo(payload("0x" + "d".repeat(40)), owner), false);
    assert.equal(relayerSubmissionBelongsTo(payload(owner, "SAFE"), owner), false);
    assert.equal(relayerSubmissionBelongsTo(payload(owner), undefined), false);
  });
});

describe("config", () => {
  const env = {
    POLYMARKET_BUILDER_CODE: "0x" + "1".repeat(64),
    POLYMARKET_BUILDER_API_KEY: "k",
    POLYMARKET_BUILDER_SECRET: "s",
    POLYMARKET_BUILDER_PASSPHRASE: "p",
    POLYMARKET_TRADING_ENABLED: "true",
  };

  it("opens trading only with the builder code and all three API credentials", () => {
    assert.equal(miniAppConfig(new Headers(), env).tradingEnabled, true);
    assert.equal(miniAppConfig(new Headers(), { ...env, POLYMARKET_BUILDER_SECRET: "" }).tradingEnabled, false);
    assert.equal(miniAppConfig(new Headers(), { ...env, POLYMARKET_BUILDER_SECRET: "" }).builderCode, "");
    assert.equal(miniAppConfig(new Headers(), { ...env, POLYMARKET_TRADING_ENABLED: "" }).tradingEnabled, false);
  });

  it("follows Polymarket's restricted jurisdictions", () => {
    assert.equal(restrictedRegion("US", null, {}), true);
    assert.equal(restrictedRegion("CA", "ON", {}), true);
    assert.equal(restrictedRegion("CA", "BC", {}), false);
    assert.equal(restrictedRegion("", "", {}), false);
    assert.equal(miniAppConfig(new Headers({ "x-vercel-ip-country": "US" }), env).restrictedRegion, true);
  });
});

const gammaMarket = {
  id: "601826",
  question: "Will Flávio Bolsonaro win the 2026 Brazilian presidential election?",
  slug: "will-flavio-bolsonaro-win",
  conditionId: "0x" + "ab".repeat(32),
  outcomes: "[\"Yes\", \"No\"]",
  outcomePrices: "[\"0.7975\", \"0.2025\"]",
  clobTokenIds: "[\"1111111111111111111111\", \"2222222222222222222222\"]",
  bestBid: 0.796,
  bestAsk: 0.799,
  oneDayPriceChange: 0.0035,
  active: true,
  closed: false,
  acceptingOrders: true,
  enableOrderBook: true,
  negRisk: true,
  endDate: "2026-10-05T03:59:00Z",
  volumeNum: 27_887_908,
  volume24hr: 1_200_000,
  image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/x.jpg",
  events: [{ id: "1", title: "Brazil Presidential Election", slug: "brazil-presidential-election" }],
};

describe("Yes/No markets", () => {
  it("parses a Gamma market with book prices; a past schedule date does not close it", () => {
    const market = parseGammaMarket(gammaMarket)!;
    assert.equal(market.id, "601826");
    assert.equal(market.eventTitle, "Brazil Presidential Election");
    assert.equal(market.yes.assetId, "1111111111111111111111");
    assert.equal(market.yes.buyPrice, 0.799);
    assert.equal(market.no.buyPrice, 0.204);
    assert.equal(market.open, true);
    assert.equal(sharePrice(market, 0), 0.799);
    assert.equal(sharePrice(market, 1), 0.204);
  });

  it("refuses non-Yes/No, decided and closed markets", () => {
    assert.equal(parseGammaMarket({ ...gammaMarket, outcomes: "[\"Lula\", \"Bolsonaro\"]" }), null);
    assert.equal(parseGammaMarket({ ...gammaMarket, outcomePrices: "[\"0.999\", \"0.001\"]" })?.open, false);
    assert.equal(parseGammaMarket({ ...gammaMarket, acceptingOrders: false })?.open, false);
  });

  it("leaves counting games out of the news markets", () => {
    const market = parseGammaMarket(gammaMarket)!;
    assert.equal(isNewsMarket(market), true);
    assert.equal(isNewsMarket({ ...market, question: "Will Elon Musk post 40-64 tweets from October 24 to October 26, 2026?" }), false);
    assert.equal(isNewsMarket({ ...market, question: "Will Trump say \"tariff\" during the speech?" }), false);
  });

  it("reads and writes channel start parameters", () => {
    assert.deepEqual(parseStartParam("m601826_1"), { marketId: "601826", side: 1 });
    assert.equal(parseStartParam("m601826_2"), null);
    assert.equal(parseStartParam("p42_1"), null);
    assert.equal(startParamFor("601826", 0), "m601826_0");
  });

  it("lists at most two markets per event, hottest events first, and the biggest moves", () => {
    const market = (id: string, volume24hr: number, change: number, yes = "0.4") => ({ ...gammaMarket, id, volume24hr, oneDayPriceChange: change, outcomePrices: `["${yes}", "${1 - Number(yes)}"]` });
    const { hot, movers } = hotMarketsFromEvents([
      [{ id: "e1", title: "Small", volume24hr: 10, markets: [market("1", 10, 0.2)] }],
      [{ id: "e2", title: "Big", volume24hr: 900, markets: [market("2", 50, 0.01), market("3", 90, -0.05), market("4", 20, 0), market("5", 99, 0, "0.99")] }],
      [{ id: "e2", title: "Big again", volume24hr: 900, markets: [market("6", 1, 0)] }],
    ]);
    assert.deepEqual(hot.map((item) => item.id), ["3", "2", "1"]);
    assert.deepEqual(movers.map((item) => item.id), []);
    const big = hotMarketsFromEvents([[{ id: "e3", volume24hr: 1, markets: [market("7", 9_000, 0.12), market("8", 9_000, -0.3)] }]]);
    assert.deepEqual(big.movers.map((item) => item.id), ["8", "7"]);
  });
});

describe("bets from positions", () => {
  const row = { token_id: "1", condition_id: "0xc", title: "Q?", outcome: "Yes", current_size: 10, avg_price: 0.4, entry_cost_usdc: 4, current_value: 6, unrealized_pnl: 2, current_price: 0.6, status: "OPEN", last_event_at: 10 };

  it("tells open, won, lost and closed bets apart", () => {
    assert.equal(betFromPosition(row)?.status, "open");
    assert.equal(betFromPosition({ ...row, status: "REDEEMABLE", redeemable: true, current_value: 10, current_price: 1 })?.redeemable, true);
    assert.equal(betFromPosition({ ...row, status: "REDEEMABLE", redeemable: true, current_value: 0, current_price: 0 })?.status, "lost");
    assert.equal(betFromPosition({ ...row, status: "REDEEMABLE_LOST", current_value: 0 })?.status, "lost");
    assert.equal(betFromPosition({ ...row, status: "CLOSED", current_price: 1, realized_pnl: 6, total_size: 10 })?.status, "won");
    assert.equal(betFromPosition({ ...row, token_id: "" }), null);
  });

  it("puts winnings to collect first, then open bets, one card per outcome", () => {
    const bets = betsFromPositions(
      [{ ...row, token_id: "a" }, { ...row, token_id: "b", status: "REDEEMABLE", redeemable: true, current_value: 5, current_price: 1 }],
      [{ ...row, token_id: "a", status: "CLOSED" }, { ...row, token_id: "c", status: "CLOSED", current_price: 0 }],
    );
    assert.deepEqual(bets.map((bet) => `${bet.assetId}:${bet.status}`), ["b:won", "a:open", "c:lost"]);
  });
});

describe("deposit wallet and limits", () => {
  it("derives distinct legacy and beacon wallets deterministically", () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const legacy = deriveLegacyDepositWalletAddress(owner);
    const beacon = deriveBeaconDepositWalletAddress(owner);
    assert.match(legacy, /^0x[0-9a-fA-F]{40}$/);
    assert.notEqual(legacy, beacon);
    assert.equal(deriveBeaconDepositWalletAddress(owner), beacon);
  });

  it("limits per key within the window", () => {
    const limiter = new WindowLimiter(2, 1_000);
    assert.equal(limiter.take("a", 0), true);
    assert.equal(limiter.take("a", 10), true);
    assert.equal(limiter.take("a", 20), false);
    assert.equal(limiter.take("b", 20), true);
    assert.equal(limiter.take("a", 1_011), true);
  });
});
