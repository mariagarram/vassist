import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUpdate, TelegramChannel, telegramOwnerNotifier } from "../src/channels/telegram";

function fakeFetch(ok = true) {
  const calls: { url: string; body: any }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(ok ? { ok: true, result: true } : { ok: false, description: "chat not found" }), { status: ok ? 200 : 400 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("parseUpdate: texto, botón pulsado, no-texto y chats de grupo", () => {
  const chat = { id: 555, type: "private" };
  assert.deepEqual(parseUpdate({ update_id: 1, message: { message_id: 1, text: "hello", chat, from: { first_name: "Ana" } } }), {
    id: "tg-1", from: "555", name: "Ana", kind: "text", text: "hello",
  });
  assert.deepEqual(parseUpdate({ update_id: 2, callback_query: { id: "c", data: "ap:abc", from: { first_name: "Ana" }, message: { message_id: 3, chat } } }), {
    id: "tg-2", from: "555", name: "Ana", kind: "reply", replyId: "ap:abc",
  });
  assert.equal(parseUpdate({ update_id: 3, message: { message_id: 1, chat } })?.kind, "unsupported");
  assert.equal(parseUpdate({ update_id: 4, message: { message_id: 1, text: "x", chat: { id: -9, type: "group" } } }), null);
});

test("TelegramChannel: botones y listas como teclado en línea, con títulos recortados", async () => {
  const { calls, impl } = fakeFetch();
  const ch = new TelegramChannel({ token: "T0K", fetchImpl: impl });
  await ch.sendButtons("555", "¿Aprobar?", [{ id: "ap:1", title: "Approve" }, { id: "rj:1", title: "Reject" }]);
  await ch.sendList("555", "Elige", "Ver", [{ id: "d:lon", title: "London", description: "UK" }, { id: "d:x", title: "x".repeat(100) }]);
  assert.match(calls[0]!.url, /bot T0K|botT0K\/sendMessage/);
  assert.deepEqual(calls[0]!.body.reply_markup.inline_keyboard, [[{ text: "Approve", callback_data: "ap:1" }], [{ text: "Reject", callback_data: "rj:1" }]]);
  assert.equal(calls[1]!.body.reply_markup.inline_keyboard[0][0].text, "London · UK");
  assert.equal(calls[1]!.body.reply_markup.inline_keyboard[1][0].text.length, 60);
});

test("errores de Telegram: el mensaje no incluye el token y el aviso a María usa su chat", async () => {
  const bad = new TelegramChannel({ token: "SECRET", fetchImpl: fakeFetch(false).impl });
  await assert.rejects(bad.sendText("1", "hi"), (e: Error) => /chat not found/.test(e.message) && !e.message.includes("SECRET"));
  const { calls, impl } = fakeFetch();
  await telegramOwnerNotifier(new TelegramChannel({ token: "T", fetchImpl: impl }), "777")({ severity: "high", text: "Aviso" });
  assert.equal(calls[0]!.body.chat_id, "777");
});

test("un corte de red momentáneo se reintenta y un error de Telegram no", async () => {
  let n = 0;
  const flaky = (async () => {
    if (++n < 3) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true, result: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await new TelegramChannel({ token: "T", fetchImpl: flaky }).call("getMe"), 1);
  assert.equal(n, 3);
  let m = 0;
  const down = (async () => { m++; throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(new TelegramChannel({ token: "T", fetchImpl: down }).call("getMe"));
  assert.equal(m, 3);
});
