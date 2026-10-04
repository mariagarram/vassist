import { createInterface } from "node:readline";
import { anthropicLlm } from "../core/agent";
import { openDb } from "../core/db";
import { Vassist } from "../core/handler";
import { Store } from "../core/store";
import type { Button, Channel, Row } from "../core/types";

/**
 * Simulador en terminal: habla con VASSIST sin WhatsApp ni Meta.
 * Los botones y listas se muestran numerados; escribe el número para pulsarlos.
 */
class ConsoleChannel implements Channel {
  options: { id: string; title: string }[] = [];

  async sendText(_to: string, text: string) {
    console.log(`\n\x1b[36mVASSIST\x1b[0m  ${text.replace(/\n/g, "\n         ")}`);
  }
  private show(body: string, opts: { id: string; title: string }[]) {
    this.options = opts;
    console.log(`\n\x1b[36mVASSIST\x1b[0m  ${body.replace(/\n/g, "\n         ")}`);
    opts.forEach((o, i) => console.log(`         \x1b[33m[${i + 1}]\x1b[0m ${o.title}`));
  }
  async sendButtons(_to: string, body: string, buttons: Button[]) {
    this.show(body, buttons);
  }
  async sendList(_to: string, body: string, _label: string, rows: Row[]) {
    this.show(body, rows);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY en .env. Copia .env.example a .env y rellénala.");
  process.exit(1);
}

const phone = (process.env.SIM_PHONE ?? "966500000001").replace(/\D/g, "");
const channel = new ConsoleChannel();
const app = new Vassist({
  store: new Store(openDb(process.env.SIM_DB ?? "data/simulador.db")),
  channel,
  llm: anthropicLlm(),
  allowed: new Set([phone]),
  notifyOwner: async (a) => console.log(`\n\x1b[31m[AVISO A MARÍA · ${a.severity}]\x1b[0m ${a.text}`),
  // En el simulador, María es el número de SIM_OWNER (por defecto otro distinto del cliente).
  ownerPhone: (process.env.SIM_OWNER ?? "34600000000").replace(/\D/g, ""),
});
setInterval(() => void app.tick(), 30_000);

console.log("VASSIST (simulador). Escribe como el cliente. Número = pulsar botón. /salir para terminar.");
let n = 0;
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  if (text === "/salir") process.exit(0);
  const id = `sim-${Date.now()}-${n++}`;
  // "/confirm ID" y "/pending" los escribe María; en el simulador se envían como si fueran suyos.
  if (/^\/(confirm|pending)\b/i.test(text)) {
    await app.handle({ id, from: (process.env.SIM_OWNER ?? "34600000000").replace(/\D/g, ""), kind: "text", text });
    return;
  }
  const pick = /^\d+$/.test(text) ? channel.options[Number(text) - 1] : undefined;
  if (pick) await app.handle({ id, from: phone, name: "Cliente", kind: "reply", replyId: pick.id });
  else await app.handle({ id, from: phone, name: "Cliente", kind: "text", text });
});
