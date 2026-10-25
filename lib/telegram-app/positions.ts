/**
 * The player's bets, read straight from their deposit wallet's Polymarket positions (Data API v2).
 * There is no bet ledger of our own: the wallet is the record.
 */

export type BetStatus = "open" | "won" | "lost" | "closed";

export type Bet = {
  assetId: string;
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  icon: string | null;
  outcome: string;
  shares: number;
  avgPrice: number;
  cost: number;
  value: number;
  pnl: number;
  curPrice: number;
  status: BetStatus;
  redeemable: boolean;
  endDate: string | null;
  updatedAt: number | null;
  /** Russian wording of the market question, when the translation cache has it. */
  titleRu?: string;
};

type Raw = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rowsOf(payload: unknown): Raw[] {
  const data = payload && typeof payload === "object" ? (payload as Raw).data : null;
  return Array.isArray(data) ? data.filter((row): row is Raw => Boolean(row && typeof row === "object")) : [];
}

/** A `/v2/positions` row (OPEN, REDEEMABLE, REDEEMABLE_LOST, MERGEABLE or CLOSED) as a bet card. */
export function betFromPosition(row: Raw): Bet | null {
  const assetId = text(row.token_id);
  const conditionId = text(row.condition_id);
  if (!assetId || !conditionId) return null;
  const status = text(row.status).toUpperCase();
  const curPrice = num(row.current_price);
  const value = num(row.current_value);
  const redeemable = row.redeemable === true && value > 0.009;
  const closed = status === "CLOSED";
  const kind: BetStatus = redeemable ? "won"
    : status === "REDEEMABLE_LOST" || (status === "REDEEMABLE" && value <= 0.009) || (!closed && curPrice <= 0.001 && value <= 0.009) ? "lost"
      : closed ? (curPrice >= 0.99 ? "won" : curPrice <= 0.01 ? "lost" : "closed")
        : "open";
  return {
    assetId,
    conditionId,
    title: text(row.title),
    slug: text(row.slug),
    eventSlug: text(row.event_slug),
    icon: text(row.icon).startsWith("https://") ? text(row.icon) : null,
    outcome: text(row.outcome),
    shares: closed ? num(row.total_size) : num(row.current_size),
    avgPrice: num(row.avg_price),
    cost: closed ? num(row.total_size) * num(row.avg_price) : num(row.entry_cost_usdc),
    value,
    pnl: closed ? num(row.realized_pnl) : num(row.unrealized_pnl),
    curPrice,
    status: kind,
    redeemable,
    endDate: text(row.end_date) || null,
    updatedAt: num(row.last_event_at) || null,
  };
}

/** Open and settled bets first (newest activity first), then closed ones; one card per outcome token. */
export function betsFromPositions(open: Raw[], closed: Raw[]) {
  const seen = new Set<string>();
  const bets: Bet[] = [];
  for (const row of [...open, ...closed]) {
    const bet = betFromPosition(row);
    if (!bet || seen.has(bet.assetId)) continue;
    seen.add(bet.assetId);
    bets.push(bet);
  }
  const rank = (bet: Bet) => (bet.status === "won" && bet.redeemable ? 0 : bet.status === "open" ? 1 : 2);
  return bets.sort((left, right) => rank(left) - rank(right) || (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}
