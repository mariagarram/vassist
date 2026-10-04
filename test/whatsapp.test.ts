import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parseWebhook, verifySignature, WhatsAppChannel, whatsappOwnerNotifier } from "../src/channels/whatsapp";

const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

test("firma del webhook: válida, manipulada y ausente", () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(body, sign(body, "s3cret"), "s3cret"), true);
  assert.equal(verifySignature(body + " ", sign(body, "s3cret"), "s3cret"), false);
  assert.equal(verifySignature(body, sign(body, "otro"), "s3cret"), false);
  assert.equal(verifySignature(body, undefined, "s3cret"), false);
  assert.equal(verifySignature(body, "sha256=zz", "s3cret"), false);
});

test("parseWebhook entiende texto, botones, listas, audio y avisos de estado", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "966500000001", profile: { name: "Dr. Test" } }],
              messages: [
                { id: "1", from: "966500000001", type: "text", text: { body: "Hello" } },
                { id: "2", from: "966500000001", type: "interactive", interactive: { button_reply: { id: "ap:abc" } } },
                { id: "3", from: "966500000001", type: "interactive", interactive: { list_reply: { id: "rg:p:5" } } },
                { id: "4", from: "966500000001", type: "audio" },
              ],
            },
          },
          { value: { statuses: [{ id: "x", status: "delivered" }] } },
        ],
      },
    ],
  };
  const events = parseWebhook(payload);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["text", "reply", "reply", "unsupported"],
  );
  assert.equal(events[0]?.name, "Dr. Test");
  const ids = events.map((e) => (e.kind === "reply" ? e.replyId : null));
  assert.deepEqual(ids, [null, "ap:abc", "rg:p:5", null]);
  assert.deepEqual(parseWebhook({}), []);
  assert.deepEqual(parseWebhook(null), []);
});

function fakeFetch(failFirst = false) {
  const calls: { url: string; body: any; auth: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) });
    if (failFirst && calls.length === 1) return new Response("outside 24h window", { status: 400 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("el cliente de WhatsApp respeta los límites de botones, listas y cuerpo", async () => {
  const f = fakeFetch();
  const ch = new WhatsAppChannel({ token: "tok", phoneId: "123", fetchImpl: f.impl });
  await ch.sendButtons("966", "x".repeat(2000), [
    { id: "a", title: "A very long button title indeed" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
    { id: "d", title: "D" },
  ]);
  const b = f.calls[0]!.body.interactive;
  assert.equal(b.action.buttons.length, 3);
  assert.ok(b.body.text.length <= 1024);
  assert.ok(b.action.buttons[0].reply.title.length <= 20);
  assert.equal(f.calls[0]!.auth, "Bearer tok");
  assert.match(f.calls[0]!.url, /\/123\/messages$/);

  await ch.sendList("966", "Rate", "Rate", Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: "t".repeat(40) })));
  const rows = f.calls[1]!.body.interactive.action.sections[0].rows;
  assert.equal(rows.length, 10);
  assert.ok(rows[0].title.length <= 24);
});

test("un error de la API se convierte en excepción", async () => {
  const ch = new WhatsAppChannel({ token: "t", phoneId: "1", fetchImpl: (async () => new Response("bad", { status: 401 })) as unknown as typeof fetch });
  await assert.rejects(() => ch.sendText("1", "hi"), /WhatsApp API 401/);
});

test("aviso a la propietaria: texto libre y, si Meta lo rechaza, plantilla sin saltos de línea", async () => {
  const f = fakeFetch(true);
  const ch = new WhatsAppChannel({ token: "t", phoneId: "1", fetchImpl: f.impl });
  const notify = whatsappOwnerNotifier(ch, "34600000000", { name: "vassist_incident", lang: "es" });
  await notify({ severity: "urgent", text: "Línea 1\n\nLínea 2\t   fin" });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0]!.body.type, "text");
  assert.equal(f.calls[1]!.body.type, "template");
  const param = f.calls[1]!.body.template.components[0].parameters[0].text;
  assert.equal(param, "Línea 1 Línea 2 fin");

  const f2 = fakeFetch(true);
  const notifyNoTemplate = whatsappOwnerNotifier(new WhatsAppChannel({ token: "t", phoneId: "1", fetchImpl: f2.impl }), "34600000000");
  await assert.rejects(() => notifyNoTemplate({ severity: "high", text: "x" }), /WhatsApp API 400/);
});
