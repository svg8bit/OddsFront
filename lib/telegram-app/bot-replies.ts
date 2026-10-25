import { parseStartParam } from "./markets.ts";

/**
 * @OddsFrontBot's chat replies. The bot has no conversation of its own: /start (and anything else
 * written to it in private) answers with a button that opens the Mini App, carrying a market deep
 * link (`/start m<id>_<side>`) through to the bet sheet.
 */

export const MINI_APP_URL = "https://oddsfront.com/tg";

type Update = {
  message?: {
    chat?: { id?: unknown; type?: unknown };
    from?: { language_code?: unknown; is_bot?: unknown };
    text?: unknown;
  };
};

export type BotReply = {
  method: "sendMessage";
  chat_id: number;
  text: string;
  parse_mode: "HTML";
  reply_markup: { inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>> };
};

const RU = /^(ru|uk|be|kk|uz|ky|tg|hy|az)/i;

/** The reply to one webhook update, or null when the bot should stay silent (groups, channels, bots). */
export function botReply(update: unknown): BotReply | null {
  const message = (update && typeof update === "object" ? (update as Update).message : null) ?? null;
  const chatId = message?.chat?.id;
  if (!message || message.chat?.type !== "private" || typeof chatId !== "number" || message.from?.is_bot === true) return null;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const payload = text.match(/^\/start(?:@\w+)?\s+(\S+)$/)?.[1] ?? "";
  const param = parseStartParam(payload);
  const url = param ? `${MINI_APP_URL}?tgWebAppStartParam=${encodeURIComponent(payload)}` : MINI_APP_URL;
  const ru = RU.test(typeof message.from?.language_code === "string" ? message.from.language_code : "");
  return {
    method: "sendMessage",
    chat_id: chatId,
    parse_mode: "HTML",
    text: ru
      ? "<b>OddsFront</b> — главные мировые события через призму шансов.\n\nВойны, геополитика, нефть и политика США с живыми рынками Polymarket. Ставка «Да» или «Нет» — в один тап, прямо в Telegram."
      : "<b>OddsFront</b> — the world's biggest stories through the odds.\n\nWars, geopolitics, oil and US politics with live Polymarket markets. Bet Yes or No in one tap, right inside Telegram.",
    reply_markup: { inline_keyboard: [[{ text: param ? (ru ? "Открыть ставку" : "Open the bet") : (ru ? "Открыть OddsFront" : "Open OddsFront"), web_app: { url } }]] },
  };
}
