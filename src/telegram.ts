import { anthropicLlm } from "./core/agent";
import { openDb } from "./core/db";
import { Vassist } from "./core/handler";
import { Store } from "./core/store";
import { parseUpdate, TelegramChannel, telegramOwnerNotifier, type TgUpdate } from "./channels/telegram";

/**
 * Modo de pruebas por Telegram (long polling): no necesita dirección pública, ni ngrok, ni Meta.
 * Para WhatsApp en producción se usa src/server.ts.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable ${name} en .env (mira .env.example)`);
    process.exit(1);
  }
  return v;
}

const digits = (s: string) => s.replace(/\D/g, "");

const token = required("TELEGRAM_TOKEN");
required("ANTHROPIC_API_KEY");

const allowed = new Set((process.env.ALLOWED_PHONES ?? "").split(",").map(digits).filter(Boolean));
const owner = digits(process.env.OWNER_PHONE ?? "");
if (allowed.size === 0) console.warn("[vassist] ALLOWED_PHONES está vacío: escribe al bot y verás tu chat id en esta ventana para pegarlo en .env.");

const channel = new TelegramChannel({ token });
const app = new Vassist({
  store: new Store(openDb(process.env.TELEGRAM_DB ?? "data/telegram.db")),
  channel,
  llm: anthropicLlm(),
  notifyOwner: owner ? telegramOwnerNotifier(channel, owner) : async (a) => console.warn("[vassist] OWNER_PHONE sin configurar. Aviso:", a.text),
  allowed,
  ownerPhone: owner || undefined,
  autoBook: true,
  askLanguage: true,
});

setInterval(() => void app.tick().catch((err) => console.error("[vassist] tick:", err)), 30_000);

const describe = (err: unknown) => {
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
  return (err instanceof Error ? err.message : String(err)).replace(token, "***") + cause;
};

// Un fallo de red momentáneo no debe tumbar el bot: se reintenta varias veces antes de rendirse.
let me: { username?: string } | undefined;
for (let attempt = 1; attempt <= 5 && !me; attempt++) {
  try {
    me = await channel.call<{ username?: string }>("getMe");
  } catch (err) {
    console.error(`No se pudo conectar con Telegram (intento ${attempt}/5): ${describe(err)}`);
    if (attempt < 5) await new Promise((r) => setTimeout(r, 3000));
  }
}
if (!me) {
  console.error("Sigue sin conexión. Revisa internet, VPN o antivirus. Si el error es 401, el TELEGRAM_TOKEN no es correcto.");
  process.exit(1);
}
// Si alguna vez hubo un webhook en este bot, Telegram no deja usar getUpdates.
await channel.call("deleteWebhook").catch(() => undefined);
console.log(`VASSIST por Telegram conectado como @${me.username}. Escríbele desde tu móvil. Ctrl+C para parar.`);

let offset = 0;
for (;;) {
  try {
    const updates = await channel.call<TgUpdate[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = parseUpdate(u);
      if (u.callback_query) void channel.call("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => undefined);
      if (!msg) continue;
      if (!allowed.has(msg.from)) {
        console.warn(`[vassist] Chat no autorizado. Para darle acceso, añade ${msg.from} a ALLOWED_PHONES en .env y reinicia.`);
        continue;
      }
      void app.handle(msg);
    }
  } catch (err) {
    console.error("[vassist] error al leer de Telegram:", err instanceof Error ? err.message.replace(token, "***") : err);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
