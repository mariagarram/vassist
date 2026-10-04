import { createServer } from "node:http";
import { anthropicLlm } from "./core/agent";
import { openDb } from "./core/db";
import { Vassist } from "./core/handler";
import { Store } from "./core/store";
import { parseWebhook, verifySignature, WhatsAppChannel, whatsappOwnerNotifier } from "./channels/whatsapp";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable ${name} en .env (mira .env.example)`);
    process.exit(1);
  }
  return v;
}

const digits = (s: string) => s.replace(/\D/g, "");

const token = required("WHATSAPP_TOKEN");
const phoneId = required("WHATSAPP_PHONE_ID");
const verifyToken = required("WHATSAPP_VERIFY_TOKEN");
const appSecret = required("WHATSAPP_APP_SECRET");
required("ANTHROPIC_API_KEY");

const allowed = new Set((process.env.ALLOWED_PHONES ?? "").split(",").map(digits).filter(Boolean));
if (allowed.size === 0) {
  console.error("ALLOWED_PHONES está vacío: nadie podría hablar con el bot. Añade al menos tu número.");
  process.exit(1);
}
const owner = digits(process.env.OWNER_PHONE ?? "");

const channel = new WhatsAppChannel({ token, phoneId, graphVersion: process.env.GRAPH_VERSION });
const template = process.env.OWNER_TEMPLATE ? { name: process.env.OWNER_TEMPLATE, lang: process.env.OWNER_TEMPLATE_LANG ?? "es" } : undefined;
const notifyOwner = owner
  ? whatsappOwnerNotifier(channel, owner, template)
  : async (a: { text: string }) => console.warn("[vassist] OWNER_PHONE sin configurar. Aviso:", a.text);

// Plantillas de utilidad aprobadas en Meta para escribir al cliente fuera de las 24 h (una por idioma, 1 variable en el cuerpo).
const clientTemplates = { en: process.env.REMINDER_TEMPLATE_EN, ar: process.env.REMINDER_TEMPLATE_AR };
const sendOutside = async (to: string, text: string, lang: "en" | "ar") => {
  const name = clientTemplates[lang];
  if (!name) throw new Error(`Falta REMINDER_TEMPLATE_${lang.toUpperCase()}: no se puede escribir al cliente fuera de las 24 h`);
  await channel.sendTemplate(to, name, lang, text);
};

const app = new Vassist({
  store: new Store(openDb()),
  channel,
  llm: anthropicLlm(),
  notifyOwner,
  allowed,
  ownerPhone: owner || undefined,
  autoBook: true,
  sendOutside,
});

// Recordatorios de check-in y check-out: se revisan cada minuto.
setInterval(() => void app.tick().catch((err) => console.error("[vassist] tick:", err)), 60_000);

function readBody(req: import("node:http").IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }

  // Verificación inicial del webhook por parte de Meta.
  if (req.method === "GET" && url.pathname === "/webhook") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end(url.searchParams.get("hub.challenge") ?? "");
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let raw: Buffer;
    try {
      raw = await readBody(req);
    } catch {
      res.writeHead(413).end();
      return;
    }
    if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, appSecret)) {
      res.writeHead(401).end();
      return;
    }
    // Responder enseguida: Meta reintenta si tardamos, y el agente puede tardar varios segundos.
    res.writeHead(200).end();
    try {
      for (const msg of parseWebhook(JSON.parse(raw.toString("utf8")))) void app.handle(msg);
    } catch (err) {
      console.error("[vassist] webhook ilegible:", err);
    }
    return;
  }

  res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 3000), () => console.log(`VASSIST escuchando en el puerto ${process.env.PORT ?? 3000}`));
