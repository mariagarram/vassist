import type { Button, Channel, Incoming, OwnerNotifier, Row } from "../core/types";

type FetchLike = typeof fetch;

export type TelegramConfig = {
  token: string;
  fetchImpl?: FetchLike;
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * Cliente mínimo de la Bot API de Telegram. Aquí el "teléfono" del núcleo es el chat id (solo dígitos).
 * Sirve para probar el flujo completo; no tiene ventana de 24 h ni plantillas, así que NO prueba esa parte de WhatsApp.
 */
export class TelegramChannel implements Channel {
  private fetchImpl: FetchLike;
  private base: string;

  constructor(private cfg: TelegramConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.base = `https://api.telegram.org/bot${cfg.token}`;
  }

  /** Llamada genérica. Nunca incluye el token en los mensajes de error. */
  async call<T = unknown>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    // Los cortes de red momentáneos (p. ej. ECONNRESET) se reintentan; los errores de Telegram (HTTP) no.
    let res: Response | undefined;
    for (let attempt = 1; !res; attempt++) {
      try {
        res = await this.fetchImpl(`${this.base}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (attempt >= 3 || signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !data?.ok) throw new Error(`Telegram API ${method} ${res.status}: ${data?.description ?? "respuesta ilegible"}`);
    return data.result as T;
  }

  sendText(to: string, text: string) {
    return this.call("sendMessage", { chat_id: to, text: clip(text, 4096) }).then(() => undefined);
  }

  /** Botones en línea, uno por fila (en el móvil se leen mejor que varios en una fila). */
  sendButtons(to: string, body: string, buttons: Button[]) {
    return this.call("sendMessage", {
      chat_id: to,
      text: clip(body, 4096),
      reply_markup: { inline_keyboard: buttons.map((b) => [{ text: clip(b.title, 60), callback_data: b.id }]) },
    }).then(() => undefined);
  }

  /** Telegram no tiene listas desplegables: cada fila es un botón. La descripción, si hay, va tras el título. */
  sendList(to: string, body: string, _label: string, rows: Row[]) {
    return this.call("sendMessage", {
      chat_id: to,
      text: clip(body, 4096),
      reply_markup: {
        inline_keyboard: rows.map((r) => [{ text: clip(r.description ? `${r.title} · ${r.description}` : r.title, 60), callback_data: r.id }]),
      },
    }).then(() => undefined);
  }
}

/** Avisos a la propietaria por su chat de Telegram. */
export function telegramOwnerNotifier(ch: TelegramChannel, ownerChatId: string): OwnerNotifier {
  return async ({ text }) => ch.sendText(ownerChatId, text);
}

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { first_name?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
  };
};

/** Convierte una actualización de Telegram en un evento del núcleo. Solo chats privados. */
export function parseUpdate(u: TgUpdate): Incoming | null {
  const id = `tg-${u.update_id}`;
  if (u.callback_query) {
    const q = u.callback_query;
    if (q.message?.chat.type !== "private") return null;
    const base = { id, from: String(q.message.chat.id), ...(q.from?.first_name ? { name: q.from.first_name } : {}) };
    return q.data ? { ...base, kind: "reply", replyId: q.data } : { ...base, kind: "unsupported" };
  }
  const m = u.message;
  if (!m || m.chat.type !== "private") return null;
  const base = { id, from: String(m.chat.id), ...(m.from?.first_name ? { name: m.from.first_name } : {}) };
  return m.text ? { ...base, kind: "text", text: m.text } : { ...base, kind: "unsupported" };
}
