import "maplibre-gl/dist/maplibre-gl.css";
import "../globals.css";
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from "@/components/root-document";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RootDocument>{children}</RootDocument>;
}
