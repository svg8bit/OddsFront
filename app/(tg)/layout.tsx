import type { Metadata, Viewport } from "next";
import "./tg.css";

export const metadata: Metadata = {
  title: "OddsFront",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1220",
};

/** The Telegram Mini App has its own bare document: no site navigation, map styles or analytics. */
export default function TelegramLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
