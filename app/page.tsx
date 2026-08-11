import type { Metadata } from "next";

import GlobalConflictMapPage from "@/app/global-conflict-map/page";
import { buildOddsFrontSocialMetadata } from "@/lib/oddsfront-site";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/"),
  alternates: {
    canonical: "/",
  },
};

export const dynamic = "force-static";
export const revalidate = 300;

export default GlobalConflictMapPage;
