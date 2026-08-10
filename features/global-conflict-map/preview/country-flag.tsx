import type { ReactNode } from "react";

interface CountryFlagProps {
  code: string;
  className?: string;
}

const HORIZONTAL_BANDS: Readonly<Record<string, readonly string[]>> = {
  CO: ["#fcd116", "#fcd116", "#003893", "#ce1126"],
  EE: ["#4891d9", "#111827", "#f8fafc"],
  ET: ["#078930", "#fcd116", "#da121a"],
  IR: ["#239f40", "#ffffff", "#da0000"],
  IQ: ["#ce1126", "#ffffff", "#111111"],
  LT: ["#fdb913", "#006a44", "#c1272d"],
  LV: ["#9e3039", "#ffffff", "#9e3039"],
  PL: ["#ffffff", "#dc143c"],
  RU: ["#ffffff", "#1769aa", "#d52b1e"],
  SD: ["#d21034", "#ffffff", "#111111"],
  UA: ["#1e73be", "#ffd700"],
  YE: ["#ce1126", "#ffffff", "#111111"],
};

const VERTICAL_BANDS: Readonly<Record<string, readonly string[]>> = {
  MX: ["#006847", "#ffffff", "#ce1126"],
};

function HorizontalBands({ colors }: { colors: readonly string[] }) {
  return colors.map((color, index) => (
    <rect
      key={`${color}-${index}`}
      x="0"
      y={(16 / colors.length) * index}
      width="24"
      height={16 / colors.length + 0.1}
      fill={color}
    />
  ));
}

function VerticalBands({ colors }: { colors: readonly string[] }) {
  return colors.map((color, index) => (
    <rect
      key={`${color}-${index}`}
      x={(24 / colors.length) * index}
      y="0"
      width={24 / colors.length + 0.1}
      height="16"
      fill={color}
    />
  ));
}

function Crescent({ x = 12, y = 8 }: { x?: number; y?: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="3.2" fill="#ffffff" />
      <circle cx={x + 1.35} cy={y - 0.45} r="2.75" fill="currentColor" />
    </>
  );
}

function specialFlag(code: string): ReactNode {
  switch (code) {
    case "CN":
      return (
        <>
          <rect width="24" height="16" fill="#de2910" />
          <path d="m4 2 .7 1.45 1.6.23-1.15 1.14.27 1.6L4 5.65 2.58 6.42l.27-1.6L1.7 3.68l1.6-.23Z" fill="#ffde00" />
        </>
      );
    case "CU":
      return (
        <>
          <HorizontalBands colors={["#002a8f", "#ffffff", "#002a8f", "#ffffff", "#002a8f"]} />
          <path d="M0 0 10 8 0 16Z" fill="#cf142b" />
          <circle cx="3.5" cy="8" r="1.2" fill="#ffffff" />
        </>
      );
    case "DK":
      return (
        <>
          <rect width="24" height="16" fill="#c8102e" />
          <rect x="7" width="2.4" height="16" fill="#ffffff" />
          <rect y="6.8" width="24" height="2.4" fill="#ffffff" />
        </>
      );
    case "GL":
      return (
        <>
          <rect width="24" height="8" fill="#ffffff" />
          <rect y="8" width="24" height="8" fill="#d00c33" />
          <path d="M3 8a5 5 0 0 1 10 0Z" fill="#d00c33" />
          <path d="M3 8a5 5 0 0 0 10 0Z" fill="#ffffff" />
        </>
      );
    case "GR":
      return (
        <>
          <HorizontalBands colors={["#0d5eaf", "#ffffff", "#0d5eaf", "#ffffff", "#0d5eaf", "#ffffff", "#0d5eaf"]} />
          <rect width="9" height="9" fill="#0d5eaf" />
          <rect x="3.5" width="2" height="9" fill="#ffffff" />
          <rect y="3.5" width="9" height="2" fill="#ffffff" />
        </>
      );
    case "IL":
      return (
        <>
          <rect width="24" height="16" fill="#ffffff" />
          <rect y="2" width="24" height="1.7" fill="#1f5fae" />
          <rect y="12.3" width="24" height="1.7" fill="#1f5fae" />
          <path d="m12 4.8 3 5.1H9Zm0 6.4L9 6.1h6Z" fill="none" stroke="#1f5fae" strokeWidth="1" />
        </>
      );
    case "IN":
      return (
        <>
          <HorizontalBands colors={["#ff9933", "#ffffff", "#138808"]} />
          <circle cx="12" cy="8" r="1.45" fill="none" stroke="#1a4c8b" strokeWidth="0.7" />
          <circle cx="12" cy="8" r="0.35" fill="#1a4c8b" />
        </>
      );
    case "JP":
      return (
        <>
          <rect width="24" height="16" fill="#ffffff" />
          <circle cx="12" cy="8" r="4" fill="#bc002d" />
        </>
      );
    case "KP":
      return (
        <>
          <HorizontalBands colors={["#024fa2", "#ffffff", "#ed1c27", "#ed1c27", "#ffffff", "#024fa2"]} />
          <circle cx="7.5" cy="8" r="2.4" fill="#ffffff" />
          <circle cx="7.5" cy="8" r="1.25" fill="#ed1c27" />
        </>
      );
    case "KR":
      return (
        <>
          <rect width="24" height="16" fill="#ffffff" />
          <path d="M9 8a3 3 0 0 1 6 0 1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 1-3 0Z" fill="#cd2e3a" />
          <path d="M15 8a3 3 0 0 1-6 0 1.5 1.5 0 0 0 3 0 1.5 1.5 0 0 1 3 0Z" fill="#0047a0" />
          <path d="m4 4 3-1M4.5 5.3l3-1m9 7.7 3-1m-3.5 2.3 3-1" stroke="#111111" strokeWidth="0.8" />
        </>
      );
    case "KW":
      return (
        <>
          <HorizontalBands colors={["#007a3d", "#ffffff", "#ce1126"]} />
          <path d="M0 0 6 5.3v5.4L0 16Z" fill="#111111" />
        </>
      );
    case "LB":
      return (
        <>
          <HorizontalBands colors={["#ed1c24", "#ffffff", "#ffffff", "#ed1c24"]} />
          <path d="m12 3.7-3.2 7h2v1.7h2.4v-1.7h2Z" fill="#00a651" />
        </>
      );
    case "OM":
      return (
        <>
          <HorizontalBands colors={["#ffffff", "#d22630", "#009a44"]} />
          <rect width="6" height="16" fill="#d22630" />
          <circle cx="3" cy="3" r="1" fill="#ffffff" />
        </>
      );
    case "PA":
      return (
        <>
          <rect width="12" height="8" fill="#ffffff" />
          <rect x="12" width="12" height="8" fill="#d21034" />
          <rect y="8" width="12" height="8" fill="#005293" />
          <rect x="12" y="8" width="12" height="8" fill="#ffffff" />
          <circle cx="6" cy="4" r="1" fill="#005293" />
          <circle cx="18" cy="12" r="1" fill="#d21034" />
        </>
      );
    case "PK":
      return (
        <g style={{ color: "#01411c" }}>
          <rect width="24" height="16" fill="#01411c" />
          <rect width="5" height="16" fill="#ffffff" />
          <Crescent x={14} y={8} />
          <circle cx="18.4" cy="4.8" r="0.75" fill="#ffffff" />
        </g>
      );
    case "PS":
      return (
        <>
          <HorizontalBands colors={["#111111", "#ffffff", "#007a3d"]} />
          <path d="M0 0 8 8 0 16Z" fill="#ce1126" />
        </>
      );
    case "SA":
      return (
        <>
          <rect width="24" height="16" fill="#006c35" />
          <path d="M5 10.7h14M7 12h10" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" />
          <rect x="8" y="5" width="8" height="2" rx="1" fill="#ffffff" opacity="0.92" />
        </>
      );
    case "SY":
      return (
        <>
          <HorizontalBands colors={["#007a3d", "#ffffff", "#111111"]} />
          <circle cx="10" cy="8" r="0.8" fill="#ce1126" />
          <circle cx="14" cy="8" r="0.8" fill="#ce1126" />
          <circle cx="12" cy="8" r="0.8" fill="#ce1126" />
        </>
      );
    case "TR":
      return (
        <g style={{ color: "#e30a17" }}>
          <rect width="24" height="16" fill="#e30a17" />
          <Crescent x={10} y={8} />
          <circle cx="15" cy="8" r="0.9" fill="#ffffff" />
        </g>
      );
    case "TW":
      return (
        <>
          <rect width="24" height="16" fill="#fe0000" />
          <rect width="11" height="8.5" fill="#000095" />
          <circle cx="5.5" cy="4.25" r="2" fill="#ffffff" />
          <circle cx="5.5" cy="4.25" r="1" fill="#000095" />
        </>
      );
    case "US":
      return (
        <>
          <HorizontalBands colors={["#b22234", "#ffffff", "#b22234", "#ffffff", "#b22234", "#ffffff", "#b22234"]} />
          <rect width="10.5" height="8.7" fill="#3c3b6e" />
          {[2, 5, 8].flatMap((x) =>
            [2, 4.5, 7].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.45" fill="#ffffff" />),
          )}
        </>
      );
    case "VE":
      return (
        <>
          <HorizontalBands colors={["#ffcc00", "#00247d", "#cf142b"]} />
          {[8.5, 10.2, 12, 13.8, 15.5].map((x, index) => (
            <circle key={x} cx={x} cy={index % 2 === 0 ? 8.3 : 7.4} r="0.45" fill="#ffffff" />
          ))}
        </>
      );
    default:
      return null;
  }
}

export function CountryFlag({ code, className }: CountryFlagProps) {
  const normalized = code.trim().toUpperCase();
  const horizontal = HORIZONTAL_BANDS[normalized];
  const vertical = VERTICAL_BANDS[normalized];
  const special = specialFlag(normalized);

  return (
    <svg
      className={className}
      viewBox="0 0 24 16"
      aria-hidden="true"
      data-country-flag={normalized}
      focusable="false"
    >
      {special ??
        (horizontal ? (
          <HorizontalBands colors={horizontal} />
        ) : vertical ? (
          <VerticalBands colors={vertical} />
        ) : (
          <>
            <rect width="24" height="16" fill="#17345d" />
            <circle cx="12" cy="8" r="4.3" fill="none" stroke="#63a8ff" strokeWidth="1" />
            <path d="M7.7 8h8.6M12 3.7c1.3 1.2 2 2.6 2 4.3s-.7 3.1-2 4.3c-1.3-1.2-2-2.6-2-4.3s.7-3.1 2-4.3Z" fill="none" stroke="#63a8ff" strokeWidth="0.8" />
          </>
        ))}
    </svg>
  );
}
