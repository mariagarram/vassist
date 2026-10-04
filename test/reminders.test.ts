import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleReminders } from "../src/core/reminders";
import { CLIENT, OWNER, say, setup, useTool } from "./helpers";

type Ctx = ReturnType<typeof setup>;

const HOTEL = {
  kind: "hotel",
  title: "Hotel Mirador London",
  details: "3 nights",
  amount_eur: 900,
  attrs: { stars: 5, starts_at: "2026-10-12T15:00:00+01:00", ends_at: "2026-10-15T11:00:00+01:00", online_checkin: true, digital_key: true, checkin_url: "https://hotel.example/checkin/ABC" },
};

/** El cliente elige un hotel y lo aprueba. Devuelve el id de la propuesta. */
async function approvedHotel(c: Ctx, attrs: Record<string, unknown> = HOTEL.attrs) {
  c.llm.queue(useTool("create_proposal", { ...HOTEL, attrs }), say("Prepared."));
  await c.text("I choose the Mirador hotel please");
  const buttons = c.channel.sent.filter((s) => s.kind === "buttons").at(-1)!;
  assert.ok(buttons.kind === "buttons");
  await c.click(buttons.options[0]!.id);
  return buttons.options[0]!.id.split(":")[1]!;
}

test("al aprobar, María recibe el ID y la orden /confirm", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  assert.match(c.alerts.at(-1)!.text, new RegExp(`/confirm ${id}`));
});

test("sin confirmar la reserva no hay recordatorios", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  c.clock.now = new Date("2026-10-20T00:00:00Z");
  await c.app.tick();
  assert.deepEqual(c.store.listReminders(id), []);
  assert.equal(c.outside.length, 0);
});

test("/pending lista lo pendiente y /confirm avisa al cliente y programa 2 recordatorios", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  c.channel.clear();
  await c.owner("/pending");
  assert.ok(c.channel.last().kind === "text" && (c.channel.last() as { text: string }).text.includes(id));

  c.channel.clear();
  await c.owner(`/confirm ${id}`);
  const toClient = c.channel.sent.find((s) => s.to === CLIENT);
  assert.ok(toClient?.kind === "text" && /now confirmed/.test(toClient.text));
  const toOwner = c.channel.sent.find((s) => s.to === OWNER);
  assert.ok(toOwner?.kind === "text" && /Recordatorios programados: 2/.test(toOwner.text));
  assert.equal(c.store.listReminders(id).length, 2);

  // confirmar dos veces no duplica ni vuelve a avisar
  c.channel.clear();
  await c.owner(`/confirm ${id}`);
  assert.equal(c.channel.sent.filter((s) => s.to === CLIENT).length, 0);
  assert.equal(c.store.listReminders(id).length, 2);
});

test("los recordatorios salen a su hora, con el enlace oficial y la llave digital, y solo una vez", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  await c.owner(`/confirm ${id}`);
  c.channel.clear();

  c.clock.now = new Date("2026-10-11T00:00:00Z"); // aún no es 24 h antes del check-in (12 oct 14:00 UTC)
  await c.app.tick();
  assert.equal(c.channel.sent.length, 0);

  c.clock.now = new Date("2026-10-11T15:00:00Z"); // ya pasan las 24 h antes
  await c.app.tick();
  const msg = c.channel.last();
  assert.ok(msg.kind === "text" && msg.to === CLIENT);
  assert.match((msg as { text: string }).text, /https:\/\/hotel\.example\/checkin\/ABC/);
  assert.match((msg as { text: string }).text, /digital key/);
  assert.match((msg as { text: string }).text, /2026-10-12 15:00/);

  await c.app.tick();
  assert.equal(c.channel.sent.length, 1, "no se repite");

  c.clock.now = new Date("2026-10-14T23:00:00Z"); // 12 h antes del check-out (15 oct 10:00 UTC = 14 oct 22:00 UTC)
  await c.app.tick();
  const out = c.channel.last();
  assert.ok(out.kind === "text" && /check-out/.test((out as { text: string }).text));
  assert.equal(c.channel.sent.length, 2);
});

test("el hotel sin check-in online no inventa ningún enlace", async () => {
  const c = setup();
  const id = await approvedHotel(c, { stars: 4, starts_at: "2026-10-12T15:00:00+01:00", ends_at: "2026-10-15T11:00:00+01:00", online_checkin: false, checkin_url: "http://not-https.example" });
  await c.owner(`/confirm ${id}`);
  c.clock.now = new Date("2026-10-12T00:00:00Z");
  c.channel.clear();
  await c.app.tick();
  const text = (c.channel.sent[0] as { text: string }).text;
  assert.match(text, /reception/);
  assert.doesNotMatch(text, /http/);
});

test("el vuelo recuerda el check-in sin prometer hacerlo", async () => {
  const c = setup();
  c.llm.queue(
    useTool("create_proposal", { kind: "flight", title: "Flight RUH-LHR", details: "d", amount_eur: 400, attrs: { airline: "Saudia", starts_at: "2026-10-12T09:00:00+03:00" } }),
    say("Prepared."),
  );
  await c.text("Please book the Saudia flight");
  const b = c.channel.sent.filter((s) => s.kind === "buttons").at(-1)!;
  assert.ok(b.kind === "buttons");
  await c.click(b.options[0]!.id);
  await c.owner(`/confirm ${b.options[0]!.id.split(":")[1]}`);
  c.clock.now = new Date("2026-10-11T12:00:00Z");
  c.channel.clear();
  await c.app.tick();
  const text = (c.channel.sent[0] as { text: string }).text;
  assert.match(text, /about 24 hours/);
  assert.match(text, /cannot complete the check-in for you yet/);
});

test("fuera de las 24 h de WhatsApp se usa la plantilla; si también falla, tras 3 intentos se avisa a María", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  await c.owner(`/confirm ${id}`);
  c.clock.now = new Date("2026-10-11T15:00:00Z");

  c.channel.failClientText = true;
  await c.app.tick();
  assert.equal(c.outside.length, 1);
  assert.equal(c.outside[0]!.lang, "en");
  assert.equal(c.store.listReminders(id).find((r) => r.kind === "hotel_checkin")!.sent, true);

  // la plantilla también falla
  c.setFailOutside(true);
  c.clock.now = new Date("2026-10-14T23:00:00Z");
  const before = c.alerts.length;
  await c.app.tick();
  await c.app.tick();
  assert.equal(c.alerts.length, before, "aún quedan intentos");
  await c.app.tick();
  assert.equal(c.alerts.length, before + 1);
  assert.match(c.alerts.at(-1)!.text, /hotel_checkout/);
  await c.app.tick();
  assert.equal(c.alerts.length, before + 1, "no insiste más");
});

test("scheduleReminders: sin fechas válidas o ya pasadas no crea nada; si el aviso ya debería haber salido, sale ya", () => {
  const c = setup();
  c.store.upsertUser(CLIENT);
  const plan = c.store.createPlan(CLIENT, "t");
  const mk = (attrs: Record<string, string>) => c.store.createProposal({ planId: plan.id, userId: CLIENT, kind: "hotel", title: "H", details: "", amountEur: 1, attrs });
  const now = new Date("2026-10-11T22:00:00Z");

  assert.equal(scheduleReminders(c.store, mk({}), now), 0);
  assert.equal(scheduleReminders(c.store, mk({ starts_at: "2026-10-01T10:00:00Z", ends_at: "2026-10-02T10:00:00Z" }), now), 0, "pasadas");

  const soon = mk({ starts_at: "2026-10-12T08:00:00Z", ends_at: "2026-10-13T08:00:00Z" });
  assert.equal(scheduleReminders(c.store, soon, now), 2);
  assert.ok(c.store.listReminders(soon.id).every((r) => r.dueAt === now.toISOString() || r.dueAt > now.toISOString()));
  assert.equal(c.store.dueReminders(now.toISOString()).filter((r) => r.proposalId === soon.id).length, 1, "el check-in ya toca, el check-out aún no");
});

test("en árabe el recordatorio sale en árabe", async () => {
  const c = setup();
  await c.text("مرحبا");
  const id = await (async () => {
    c.llm.queue(useTool("create_proposal", { ...HOTEL }), say("حسناً"));
    await c.text("أريد فندق ميرادور في لندن من فضلك");
    const b = c.channel.sent.filter((s) => s.kind === "buttons").at(-1)!;
    assert.ok(b.kind === "buttons");
    await c.click(b.options[0]!.id);
    return b.options[0]!.id.split(":")[1]!;
  })();
  await c.owner(`/confirm ${id}`);
  c.clock.now = new Date("2026-10-11T15:00:00Z");
  c.channel.clear();
  await c.app.tick();
  assert.match((c.channel.sent[0] as { text: string }).text, /تذكير/);
});

test("solo María puede usar /confirm: un cliente que lo escribe lo manda al agente como texto normal", async () => {
  const c = setup();
  const id = await approvedHotel(c);
  c.llm.queue(say("I cannot do that."));
  await c.text(`/confirm ${id}`);
  assert.equal(c.store.getProposal(id)!.confirmed, false);
});
