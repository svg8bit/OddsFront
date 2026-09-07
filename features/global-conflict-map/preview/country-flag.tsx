import countryCodes from "@/lib/country-flag-codes.json";

const available = new Set(countryCodes);
const aliases: Readonly<Record<string, string>> = { UK: "GB", EL: "GR" };

export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const requested = code.trim().toUpperCase();
  const normalized = aliases[requested] || requested;
  const supported = available.has(normalized);
  return <svg className={className} viewBox="0 0 24 18" aria-hidden="true" data-country-flag={normalized} data-flag-available={supported} focusable="false">
    {supported ? <image href={`/flags/${normalized.toLowerCase()}.svg?v=7.5.0`} width="24" height="18" preserveAspectRatio="xMidYMid meet"/> : <><rect width="24" height="18" fill="#17345d"/><circle cx="12" cy="9" r="5" fill="none" stroke="#63a8ff"/><path d="M7 9h10M12 4q4 5 0 10q-4-5 0-10" fill="none" stroke="#63a8ff"/></>}
  </svg>;
}
