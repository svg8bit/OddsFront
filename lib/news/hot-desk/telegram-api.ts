import { readFile, stat } from "node:fs/promises";
import { HOT_DESK_CHANNELS, MINI_APP_BOT, type HotDeskLocale } from "./post.ts";

export class TelegramRejection extends Error {
  // Node runs these files by stripping types, so no parameter properties.
  readonly definite: boolean;
  constructor(message: string, definite: boolean) { super(message); this.definite = definite; }
}

/** The user-authorized @DropsAnalyticsAIbot token: inline env, or one named key of a protected credential file. */
export async function botToken(env: Record<string, string | undefined> = process.env) {
  if (env.ODDSFRONT_TELEGRAM_BOT_TOKEN) return env.ODDSFRONT_TELEGRAM_BOT_TOKEN;
  const file = env.ODDSFRONT_TELEGRAM_CREDENTIAL_ENV;
  const key = env.ODDSFRONT_TELEGRAM_CREDENTIAL_KEY || "ODDSFRONT_TELEGRAM_BOT_TOKEN";
  if (!file || !/^[A-Z_]+$/.test(key)) throw new Error("Telegram credential reference is not configured");
  const mode = await stat(file);
  if ((mode.mode & 0o077) !== 0) throw new Error("Telegram credential file permissions must be 600");
  // Read only the named bot key; never import or copy another product's environment.
  const value = (await readFile(file, "utf8")).split(/\r?\n/).filter(line => line.startsWith(`${key}=`)).at(-1)?.slice(key.length + 1).trim();
  const token = value?.replace(/^(["'])(.*)\1$/, "$2");
  if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error("Named Telegram bot credential is missing");
  return token;
}

export function telegramClient(token: string) {
  async function call<T = Record<string, unknown>>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, body instanceof FormData
        ? { method: "POST", body, signal: AbortSignal.timeout(60_000) }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch { throw new TelegramRejection(`Telegram ${method} transport failed`, false); }
    const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; error_code?: number } | null;
    if (!response.ok || !data?.ok) {
      const code = data?.error_code ?? response.status;
      throw new TelegramRejection(`Telegram ${method} rejected (${code})`, code >= 400 && code < 500 && code !== 408 && code !== 429);
    }
    return data.result as T;
  }

  return {
    call,
    async verifyBot() {
      const bot = await call<{ id: number; username?: string }>("getMe", {});
      if (bot.username?.toLowerCase() !== MINI_APP_BOT.toLowerCase()) throw new Error("Wrong Telegram bot identity");
      return bot;
    },
    /** The bot must be a posting administrator of exactly the expected public channel. */
    async verifyChannel(locale: HotDeskLocale, botId: number) {
      const channel = HOT_DESK_CHANNELS[locale];
      const chat = await call<{ id: number; username?: string; type: string }>("getChat", { chat_id: channel.id });
      const member = await call<{ status: string; can_post_messages?: boolean }>("getChatMember", { chat_id: channel.id, user_id: botId });
      if (chat.id !== channel.id || chat.username !== channel.username || chat.type !== "channel" || member.status !== "administrator" || !member.can_post_messages) throw new Error(`OddsFront ${locale} channel posting rights are missing`);
    },
    async sendPhoto(chatId: number | string, png: Buffer, caption: string, replyMarkup: unknown) {
      const form = new FormData();
      form.set("chat_id", String(chatId));
      form.set("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "oddsfront.png");
      form.set("caption", caption);
      form.set("parse_mode", "HTML");
      form.set("reply_markup", JSON.stringify(replyMarkup));
      const message = await call<{ message_id?: number; chat?: { id?: number }; photo?: unknown[] }>("sendPhoto", form);
      if (!message.message_id || !Array.isArray(message.photo) || !message.photo.length) throw new TelegramRejection("Unexpected Telegram sendPhoto receipt", false);
      return message as { message_id: number; chat?: { id?: number } };
    },
  };
}
