import { miniAppConfig } from "@/lib/telegram-app/config";
import { privateJson } from "@/lib/telegram-app/request";

export const dynamic = "force-dynamic";

/** Builder code and whether betting is open for this visitor. */
export function GET(request: Request) {
  return privateJson(miniAppConfig(request.headers));
}
