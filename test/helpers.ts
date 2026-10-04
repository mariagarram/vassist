import type Anthropic from "@anthropic-ai/sdk";
import { openDb } from "../src/core/db";
import { Vassist } from "../src/core/handler";
import { Store } from "../src/core/store";
import type { Button, Channel, Llm, OwnerAlert, Row } from "../src/core/types";

export type Sent =
  | { kind: "text"; to: string; text: string }
  | { kind: "buttons"; to: string; body: string; options: Button[] }
  | { kind: "list"; to: string; body: string; options: Row[] }
  | { kind: "photo"; to: string; url: string; body: string; options: Button[] }
  | { kind: "location"; to: string; lat: number; lon: number; title: string };

export class FakeChannel implements Channel {
  sent: Sent[] = [];
  /** Simula que WhatsApp rechaza el texto libre al cliente (fuera de las 24 h). */
  failClientText = false;
  async sendText(to: string, text: string) {
    if (this.failClientText && to !== OWNER) throw new Error("WhatsApp API 400: outside 24h window");
    this.sent.push({ kind: "text", to, text });
  }
  async sendButtons(to: string, body: string, options: Button[]) {
    this.sent.push({ kind: "buttons", to, body, options });
  }
  async sendList(to: string, body: string, _label: string, options: Row[]) {
    this.sent.push({ kind: "list", to, body, options });
  }
  async sendPhoto(to: string, url: string, body: string, options: Button[] = []) {
    this.sent.push({ kind: "photo", to, url, body, options });
  }
  async sendLocation(to: string, lat: number, lon: number, title: string) {
    this.sent.push({ kind: "location", to, lat, lon, title });
  }
  last() {
    return this.sent[this.sent.length - 1]!;
  }
  clear() {
    this.sent = [];
  }
}

type Block = Anthropic.ContentBlock;
const msg = (content: Block[], stop: "tool_use" | "end_turn"): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Anthropic.Message;

let toolN = 0;
export const say = (text: string) => msg([{ type: "text", text, citations: null } as Block], "end_turn");
export const useTool = (name: string, input: Record<string, unknown>) =>
  msg([{ type: "tool_use", id: `t${toolN++}`, name, input } as Block], "tool_use");

/** Modelo simulado: devuelve las respuestas del guion, en orden. */
export class ScriptedLlm implements Llm {
  script: Anthropic.Message[] = [];
  systems: string[] = [];
  calls = 0;
  requests: { messages: unknown[] }[] = [];
  queue(...m: Anthropic.Message[]) {
    this.script.push(...m);
  }
  async create(p: { system: string; messages?: unknown[] }) {
    this.calls++;
    this.systems.push(p.system);
    this.requests.push({ messages: JSON.parse(JSON.stringify(p.messages ?? [])) });
    const next = this.script.shift();
    if (!next) throw new Error("ScriptedLlm: no quedan respuestas en el guion");
    return next;
  }
}

export const CLIENT = "966500000001";
export const OWNER = "34600000000";

export function setup(opts: { autoBook?: boolean } = {}) {
  const store = new Store(openDb(":memory:"));
  const channel = new FakeChannel();
  const llm = new ScriptedLlm();
  const alerts: OwnerAlert[] = [];
  const outside: { to: string; text: string; lang: string }[] = [];
  const clock = { now: new Date("2026-10-03T10:00:00Z") };
  let failOutside = false;
  const app = new Vassist({
    store,
    channel,
    llm,
    allowed: new Set([CLIENT]),
    notifyOwner: async (a) => void alerts.push(a),
    today: () => "2026-10-03",
    now: () => clock.now,
    ownerPhone: OWNER,
    autoBook: opts.autoBook ?? false,
    sendOutside: async (to, text, lang) => {
      if (failOutside) throw new Error("template rejected");
      outside.push({ to, text, lang });
    },
  });
  let n = 0;
  const text = (t: string, from = CLIENT) => app.handle({ id: `w${n++}`, from, name: "Client", kind: "text", text: t });
  const click = (replyId: string, from = CLIENT) => app.handle({ id: `w${n++}`, from, kind: "reply", replyId });
  const owner = (t: string) => app.handle({ id: `w${n++}`, from: OWNER, kind: "text", text: t });
  return { store, channel, llm, alerts, app, text, click, owner, outside, clock, setFailOutside: (v: boolean) => void (failOutside = v) };
}
