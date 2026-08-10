const NON_BREAKING_SPACE = "\u00a0";
const MONTH_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const CALENDAR_DATE_PATTERN = new RegExp(
  `\\b(?:(?:by|before|after|until|through|on)\\s+)?${MONTH_PATTERN}\\s+\\d{1,2}(?:,?\\s+20\\d{2})?`,
  "gi",
);
const YEAR_TAIL_PATTERN =
  /\b(?:in|by|before|after|until|through)\s+20\d{2}\b/gi;

function keepTogether(value: string): string {
  return value.replaceAll(" ", NON_BREAKING_SPACE);
}

export function formatMarketTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  let formatted = normalized
    .replace(CALENDAR_DATE_PATTERN, keepTogether)
    .replace(YEAR_TAIL_PATTERN, keepTogether);

  const lineUnits = formatted.split(" ");
  const lastUnit = lineUnits.at(-1);
  if (
    lineUnits.length >= 4 &&
    lastUnit &&
    !lastUnit.includes(NON_BREAKING_SPACE)
  ) {
    formatted = `${lineUnits.slice(0, -2).join(" ")} ${keepTogether(
      lineUnits.slice(-2).join(" "),
    )}`;
  }

  return formatted;
}
