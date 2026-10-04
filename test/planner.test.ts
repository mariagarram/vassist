import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT, say, setup, useTool, type Sent } from "./helpers";

type Ctx = ReturnType<typeof setup>;
type Choice = Extract<Sent, { options: unknown[] }>;

const last = (c: Ctx): Choice => {
  const m = [...c.channel.sent].reverse().find((s) => s.kind === "buttons" || s.kind === "list" || s.kind === "photo");
  assert.ok(m && (m.kind === "buttons" || m.kind === "list" || m.kind === "photo"));
  return m as Choice;
};
const ids = (c: Ctx) => last(c).options.map((o) => o.id);
/** Pulsa la opción n (0 = primera) del último menú. */
const pick = async (c: Ctx, n: number) => c.click(last(c).options[n]!.id);
const tap = async (c: Ctx, id: string) => {
  assert.ok(ids(c).includes(id), `no hay ${id} en ${ids(c).join(", ")}`);
  await c.click(id);
};
const texts = (c: Ctx) => c.channel.sent.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text);

test("planificador: todo por botones, resumen, plan de la IA y botones de crear/ajustar", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  // 1 destino: recuadro de texto (cualquier ciudad, pueblo o país)
  assert.match(texts(c).at(-1)!, /write the place/);
  await c.text("Vejer de la Frontera");
  // 2 origen: sin aeropuerto guardado se pregunta por escrito
  assert.match(texts(c).at(-1)!, /depart from/);
  await c.text("Malaga");
  // 3..13 todo por botones
  for (let q = 2; q < 12; q++) {
    assert.ok(ids(c)[0]!.startsWith(`p:${q}:`), `pregunta ${q}: ${ids(c).join(",")}`);
    if (q === 10) {
      await pick(c, 1); // intereses: primera opción tras «Hecho»
      await tap(c, "p:10:d");
    } else await pick(c, 0);
  }
  // 13 notas
  await pick(c, 0);
  const summary = last(c);
  assert.equal(summary.kind, "buttons");
  assert.match(summary.body, /Destination: Vejer de la Frontera/);
  assert.match(summary.body, /Departing from: Malaga/);
  assert.match(summary.body, /Interests: Culture and history/);
  assert.deepEqual(ids(c), ["p:go", "p:redo", "p:cancel"]);

  c.llm.queue(say("Day 1: arrive in Jerez. Estimated total: EUR 900."));
  await tap(c, "p:go");
  const sent = c.llm.requests.at(-1)!;
  assert.match(JSON.stringify(sent.messages.at(-1)), /Trip planner form/);
  assert.match(JSON.stringify(sent.messages.at(-1)), /Destination: Vejer de la Frontera/);
  assert.match(texts(c).at(-1)!, /Estimated total/);
  assert.deepEqual(ids(c), ["p:st", "p:make", "p:adj"]);
  assert.equal(c.store.getWizard(CLIENT), null);

  // «Crear propuestas» se lo pasa a la IA, que crea la propuesta
  c.llm.queue(
    useTool("create_proposal", { kind: "transport", title: "Train Malaga to Jerez", details: "approx 3h, estimate", amount_eur: 60, attrs: { mode: "train" } }),
    say("Prepared."),
  );
  await tap(c, "p:make");
  assert.equal(c.store.listProposals(CLIENT)[0]!.kind, "transport");
});

test("planificador: escribir texto libre lo abandona y lo atiende la IA; saltar el resto va al resumen", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Madrid"); // destino por escrito
  await c.text("Rome"); // origen por escrito
  await pick(c, 0); // propósito
  c.llm.queue(say("Of course, a question for you."));
  await c.text("what about visas?");
  assert.match(texts(c).at(-1)!, /a question for you/);
  assert.equal(c.store.getWizard(CLIENT), null);

  await c.click("m:plan");
  await c.text("Madrid");
  await c.text("Rome");
  await pick(c, 0);
  await pick(c, 0);
  await tap(c, "p:4:s"); // saltar el resto
  assert.deepEqual(ids(c), ["p:go", "p:redo", "p:cancel"]);
  await tap(c, "p:cancel");
  assert.equal(c.store.getWizard(CLIENT), null);
});

test("planificador en árabe: sale en árabe y los botones viejos no rompen nada", async () => {
  const c = setup();
  await c.text("مرحبا");
  await c.click("m:plan");
  assert.match(texts(c).at(-1)!, /اكتبوا اسم المكان/);
  await c.click("p:7:1"); // botón de otra pregunta: obsoleto
  assert.ok(texts(c).some((x) => /لم يعد متاحاً/.test(x)));
});

test("planificador: ofrece hoteles y apartamentos y «Reservar» crea la propuesta aprobada y avisa a María", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Vejer de la Frontera");
  await c.text("Malaga");
  for (let q = 2; q < 12; q++) {
    if (q === 10) {
      await pick(c, 1);
      await tap(c, "p:10:d");
    } else await pick(c, q === 8 ? 3 : 0); // alojamiento: «Hotel boutique» no; la 4.ª opción es «Apartamento»
  }
  await pick(c, 0);
  c.llm.queue(say("Plan text."));
  await tap(c, "p:go");
  await tap(c, "p:st");
  const list = last(c);
  assert.equal(list.kind, "list");
  assert.ok(list.options.some((o) => /Apartamento|Loft/.test(o.title)), "debe incluir apartamentos");
  assert.match(JSON.stringify(list.options), /EUR \d+ per night/);
  assert.ok(list.options[0]!.id.startsWith("p:b:"));
  await c.click(list.options[0]!.id);
  assert.deepEqual(ids(c), ["p:bk:0", "p:bl"]);
  // tarjeta visual: pin del mapa y foto de muestra con los botones
  assert.equal(last(c).kind, "photo");
  assert.match((last(c) as { url: string }).url, /^https:\/\//);
  assert.ok(c.channel.sent.some((s) => s.kind === "location"));
  assert.match(last(c).body, /Sample data/);
  await c.click("p:bk:0");
  const [proposal] = c.store.listProposals(CLIENT);
  assert.equal(proposal!.kind, "hotel");
  assert.equal(proposal!.status, "approved");
  assert.ok(String(proposal!.attrs.starts_at).includes("T15:00:00"));
  assert.match(c.alerts.at(-1)!.text, new RegExp(`/confirm ${proposal!.id}`));
  // un segundo toque no duplica la reserva
  await c.click("p:bk:0");
  assert.equal(c.store.listProposals(CLIENT).length, 1);
});

async function planUntilStays(c: Ctx) {
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Granada");
  await c.text("Malaga");
  for (let q = 2; q < 12; q++) {
    if (q === 10) {
      await pick(c, 1);
      await tap(c, "p:10:d");
    } else await pick(c, 0);
  }
  await pick(c, 0);
  c.llm.queue(say("Plan text."));
  await tap(c, "p:go");
  await tap(c, "p:st");
  await c.click(last(c).options[0]!.id);
}

test("reserva automática: «Reservar» confirma al momento, sin María, y programa recordatorios", async () => {
  const c = setup({ autoBook: true });
  await planUntilStays(c);
  await c.click("p:bk:0");
  const [p] = c.store.listProposals(CLIENT);
  assert.ok(p!.confirmed);
  assert.match(texts(c).at(-1)!, /Booked: .*Reference SIM-.*TEST MODE/s);
  assert.equal(c.alerts.length, 0, "María no recibe nada si todo va bien");
  assert.equal(c.store.listReminders(p!.id).length, 2);
});

test("si la reserva automática falla, el cliente lo sabe y María recibe un aviso urgente", async () => {
  const c = setup({ autoBook: true });
  const { providers } = await import("../src/core/providers");
  const orig = providers.book;
  providers.book = async () => ({ ok: false, reason: "payment declined" });
  try {
    await planUntilStays(c);
    await c.click("p:bk:0");
  } finally {
    providers.book = orig;
  }
  const [p] = c.store.listProposals(CLIENT);
  assert.ok(!p!.confirmed);
  assert.match(texts(c).at(-1)!, /could not complete the booking/);
  assert.equal(c.alerts.at(-1)!.severity, "high");
  assert.match(c.alerts.at(-1)!.text, /FALLO.*payment declined.*\/confirm .*\/decline/s);
});

test("restaurante: el cliente lo solicita, María recibe la petición y /decline o /confirm avisan al cliente", async () => {
  const c = setup({ autoBook: true });
  await c.text("hello");
  c.llm.queue(useTool("create_proposal", { kind: "restaurant", title: "Dinner at La Mesa", details: "Fri 21:00, 2 people", amount_eur: 80 }), say("Here is a dinner option."));
  await c.text("book me a dinner in Granada");
  const id = c.store.listProposals(CLIENT)[0]!.id;
  await c.click(`ap:${id}`);
  assert.match(texts(c).at(-1)!, /Maria will contact/);
  assert.match(c.alerts.at(-1)!.text, new RegExp(`PETICIÓN.*/confirm ${id}.*/decline ${id}`, "s"));
  await c.owner(`/decline ${id}`);
  assert.ok(c.channel.sent.some((m) => m.kind === "text" && m.to === CLIENT && /not possible/.test(m.text)));
  assert.equal(c.store.getProposal(id)!.status, "rejected");
});
