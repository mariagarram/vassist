import { createHmac, timingSafeEqual } from "node:crypto";
import type { Button, Channel, Incoming, OwnerNotifier, Row } from "../core/types";

type FetchLike = typeof fetch;

export type WhatsAppConfig = {
  token: string;
  phoneId: string;
  graphVersion?: string;
  fetchImpl?: FetchLike;
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Cliente mínimo de la WhatsApp Cloud API. */
export class WhatsAppChannel implements Channel {
  private fetchImpl: FetchLike;
  private url: string;

  constructor(private cfg: WhatsAppConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.url = `https://graph.facebook.com/${cfg.graphVersion ?? "v23.0"}/${cfg.phoneId}/messages`;
  }

  private async post(body: Record<string, unknown>) {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  sendText(to: string, text: string) {
    return this.post({ to, type: "text", text: { body: text, preview_url: false } });
  }

  /** Hasta 3 botones de respuesta; título máx. 20 caracteres, cuerpo máx. 1024. */
  sendButtons(to: string, body: string, buttons: Button[]) {
    return this.post({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clip(body, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })) },
      },
    });
  }

  /** Tarjeta: botones de respuesta con la foto como cabecera (el enlace debe ser público, HTTPS). */
  sendPhoto(to: string, url: string, caption: string, buttons: Button[] = []) {
    if (!buttons.length) return this.post({ to, type: "image", image: { link: url, caption: clip(caption, 1024) } });
    return this.post({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "image", image: { link: url } },
        body: { text: clip(caption, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })) },
      },
    });
  }

  sendLocation(to: string, lat: number, lon: number, title: string) {
    return this.post({ to, type: "location", location: { latitude: lat, longitude: lon, name: clip(title, 100) } });
  }

  /** Lista de hasta 10 filas; título de fila máx. 24 caracteres, botón máx. 20. */
  sendList(to: string, body: string, label: string, rows: Row[]) {
    return this.post({
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: clip(body, 1024) },
        action: {
          button: clip(label, 20),
          sections: [{ title: clip(label, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })) }],
        },
      },
    });
  }

  /** Plantilla aprobada (necesaria para escribir fuera de la ventana de 24 h). Un solo parámetro de cuerpo. */
  sendTemplate(to: string, name: string, lang: string, param: string) {
    // Los parámetros de plantilla no admiten saltos de línea ni espacios repetidos.
    const clean = clip(param.replace(/\s+/g, " ").trim(), 900);
    return this.post({
      to,
      type: "template",
      template: { name, language: { code: lang }, components: [{ type: "body", parameters: [{ type: "text", text: clean }] }] },
    });
  }
}

/**
 * Avisos a la propietaria. Primero texto libre (gratis y sin plantilla si ella ha escrito
 * al bot en las últimas 24 h); si Meta lo rechaza, usa la plantilla de utilidad.
 */
export function whatsappOwnerNotifier(ch: WhatsAppChannel, owner: string, template?: { name: string; lang: string }): OwnerNotifier {
  return async ({ text }) => {
    try {
      await ch.sendText(owner, text);
    } catch (err) {
      if (!template) throw err;
      await ch.sendTemplate(owner, template.name, template.lang, text);
    }
  };
}

/** Comprueba la cabecera X-Hub-Signature-256 con el secreto de la app. */
export function verifySignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type WebhookBody = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body?: string };
          interactive?: { button_reply?: { id: string }; list_reply?: { id: string } };
        }[];
      };
    }[];
  }[];
};

/** Convierte el JSON del webhook en eventos del núcleo. Ignora los avisos de estado (entregado, leído...). */
export function parseWebhook(body: unknown): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of (body as WebhookBody)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        const name = names.get(m.from);
        const base = { id: m.id, from: m.from, ...(name ? { name } : {}) };
        if (m.type === "text" && m.text?.body) out.push({ ...base, kind: "text", text: m.text.body });
        else if (m.type === "interactive") {
          const replyId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
          out.push(replyId ? { ...base, kind: "reply", replyId } : { ...base, kind: "unsupported" });
        } else out.push({ ...base, kind: "unsupported" });
      }
    }
  }
  return out;
}
