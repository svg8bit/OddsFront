/** Number formats shared by the Mini App screens. */

export function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Cents are never rounded up: a balance or payout shows what is really there. */
export function floorUsd(value: number) {
  return formatUsd(Math.floor(value * 100) / 100);
}

/** 0.234 → "23%", 0.024 → "2.4%", 0.004 → "<1%". */
export function formatChance(price: number | null | undefined) {
  if (typeof price !== "number" || !Number.isFinite(price)) return "—";
  const percent = price * 100;
  if (percent > 0 && percent < 1) return "<1%";
  if (percent > 99 && percent < 100) return ">99%";
  return percent < 10 ? `${(Math.round(percent * 10) / 10).toString()}%` : `${Math.round(percent)}%`;
}

/** Decimal odds of a share bought at `price` (0.25 → "4.00"). */
export function formatOdds(price: number | null | undefined) {
  return typeof price === "number" && price > 0 && price < 1 ? (1 / price).toFixed(2) : "—";
}

/** A 24 h move in percentage points ("▲ 4.1 pp" / "▼ 12 п.п."), or null when it rounds to nothing. */
export function formatMove(change: number | null | undefined, language: "ru" | "en") {
  if (typeof change !== "number" || !Number.isFinite(change)) return null;
  const points = change * 100;
  if (Math.abs(points) < 0.5) return null;
  const size = Math.abs(points) < 10 ? Math.round(Math.abs(points) * 10) / 10 : Math.round(Math.abs(points));
  return { up: points > 0, text: `${points > 0 ? "▲" : "▼"} ${size} ${language === "ru" ? "п.п." : "pp"}` };
}

export function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(Math.round(value / 100_000) / 10).toString()}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/** "31 окт" / "Oct 31"; the year only when it is not this year's. */
export function formatEndDate(value: string | null, language: "ru" | "en") {
  if (!value) return null;
  const date = new Date(value);
  // A past schedule date says nothing useful: markets often keep trading until they resolve.
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now()) return null;
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).replace(/\.$/, "");
}

export function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
