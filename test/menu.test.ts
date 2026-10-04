import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate } from "../src/core/menu";
import { CLIENT, OWNER, say, setup, type Sent } from "./helpers";

type Ctx = ReturnType<typeof setup>;
type Choice = Extract<Sent, { options: unknown[] }>;

const lastChoice = (c: Ctx): Choice => {
  const m = [...c.channel.sent].reverse().find((s) => s.kind === "buttons" || s.kind === "list");
  assert.ok(m && (m.kind === "buttons" || m.kind === "list"), "se esperaba un menú, botones o lista");
  return m as Choice;
};
const optionIds = (m: Choice) => m.options.map((o) => o.id);
/** Pulsa la opción cuyo id empieza por `prefix` (o la n-ésima de ese prefijo). */
async function tap(c: Ctx, prefix: string, nth = 0) {
  const ids = optionIds(lastChoice(c)).filter((id) => id.startsWith(prefix));
  assert.ok(ids[nth], `no hay opción ${prefix} en ${optionIds(lastChoice(c)).join(", ")}`);
  await c.click(ids[nth]!);
}
const textsOf = (c: Ctx) => c.channel.sent.filter((s): s is Extract<Sent, { kind: "text" }> => s.kind === "text").map((s) => s.text);

/** Cliente nuevo hasta el primer paso del viaje completo, sin IA. */
async function startFull(c: Ctx) {
  await c.text("Hello");
  await tap(c, "m:new");
  await tap(c, "t:full");
}

test("viaje completo solo con menús, sin llamar a la IA: ida, hotel y vuelta", async () => {
  const c = setup();
  await startFull(c);

  const dest = lastChoice(c);
  assert.deepEqual(dest.options.map((o) => o.title), ["London", "Paris", "Zurich", "New York", "Other destination"]);
  await tap(c, "c:0"); // London
  await tap(c, "n:3");
  const dates = lastChoice(c);
  assert.equal(dates.options[0]!.id, "d:2026-10-04", "la primera fecha es mañana");
  await tap(c, "d:2026-10-04");

  // sin aeropuerto guardado, lo pide una vez y lo recuerda
  assert.match(textsOf(c).at(-1)!, /3-letter code/);
  await c.text("ruh");
  assert.equal(c.store.getPrefs(CLIENT).home_airport, "RUH");

  const flights = lastChoice(c);
  assert.equal(flights.kind, "list");
  assert.ok(flights.options.length >= 1 && flights.options.length <= 3);
  assert.match((flights.options[0] as { description?: string }).description!, /recommended/);
  await tap(c, "o:0");

  // el vuelo de ida queda propuesto (con botones de aprobar) y el menú sigue con el hotel
  const approvals = () => c.channel.sent.filter((s) => s.kind === "buttons" && s.options[0]!.id.startsWith("ap:"));
  assert.equal(approvals().length, 1);
  const hotels = lastChoice(c);
  assert.match(hotels.body, /Hotels in London for 3 nights/);
  assert.ok(hotels.options.length >= 1);
  await tap(c, "o:0");
  assert.equal(approvals().length, 2);

  const ret = lastChoice(c);
  assert.deepEqual(optionIds(ret), ["r:yes", "r:no"]);
  assert.match(ret.body, /return flight/);
  await tap(c, "r:yes");
  assert.match(lastChoice(c).body, /Return flights from LHR to RUH/);
  await tap(c, "o:0");
  assert.equal(approvals().length, 3);
  assert.match(textsOf(c).at(-1)!, /waiting for your approval/);
  assert.equal(c.llm.calls, 0, "ningún paso del menú usa la IA");

  // datos de la reserva: horas con zona horaria, noches y aeropuertos
  const [out, hotel, back] = c.store.listProposals(CLIENT).reverse();
  assert.equal(out!.kind, "flight");
  assert.match(String(out!.attrs.starts_at), /^2026-10-04T\d\d:\d\d:00\+03:00$/);
  assert.equal(hotel!.kind, "hotel");
  assert.equal(hotel!.attrs.starts_at, "2026-10-04T15:00:00+01:00");
  assert.equal(hotel!.attrs.ends_at, "2026-10-07T11:00:00+01:00");
  assert.equal(typeof hotel!.attrs.online_checkin, "boolean");
  assert.match(String(back!.attrs.starts_at), /^2026-10-07T\d\d:\d\d:00\+01:00$/);
  assert.equal(new Set([out, hotel, back].map((p) => p!.planId)).size, 1, "los tres cuelgan del mismo plan");

  // se aprueba todo: al decidir el último se pide la valoración global
  for (const a of approvals()) await c.click((a as Choice).options[0]!.id);
  assert.equal(lastChoice(c).options[0]!.id.startsWith("rg:"), true);

  // María confirma y se programan los recordatorios (2 vuelos + check-in y check-out)
  let reminders = 0;
  for (const p of [out!, hotel!, back!]) {
    await c.owner(`/confirm ${p.id}`);
    reminders += c.store.listReminders(p.id).length;
  }
  assert.equal(reminders, 4);
});

test("solo vuelo: termina tras elegir y no ofrece hotel", async () => {
  const c = setup();
  c.store.upsertUser(CLIENT);
  c.store.setPref(CLIENT, "home_airport", "RUH");
  await c.text("hello");
  await tap(c, "m:new");
  await tap(c, "t:flight");
  await tap(c, "c:1"); // Paris
  assert.equal(optionIds(lastChoice(c))[0], "d:2026-10-04", "sin noches: va directo a la fecha");
  await tap(c, "d:2026-10-05");
  await tap(c, "o:0");
  assert.equal(c.store.listProposals(CLIENT).length, 1);
  assert.match(textsOf(c).at(-1)!, /waiting for your approval/);
  assert.equal(c.store.getWizard(CLIENT), null);
});

test("solo hotel: no pregunta aeropuerto y pone primero los hoteles con check-in online", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:new");
  await tap(c, "t:hotel");
  await tap(c, "c:0");
  await tap(c, "n:2");
  await tap(c, "d:2026-10-04");
  const list = lastChoice(c);
  assert.match(list.body, /Hotels in London for 2 nights/);
  const withOnline = list.options.map((o) => /online check-in/.test((o as { description?: string }).description ?? ""));
  assert.deepEqual(withOnline, [...withOnline].sort((a, b) => Number(b) - Number(a)), "primero los que tienen check-in online");
  await tap(c, "o:0");
  const [h] = c.store.listProposals(CLIENT);
  assert.equal(h!.kind, "hotel");
  assert.equal(c.llm.calls, 0);
});

test("respeta las preferencias: no ofrece aerolíneas a evitar", async () => {
  const c = setup();
  await c.text("hello");
  c.store.setPref(CLIENT, "home_airport", "RUH");
  await tap(c, "m:new");
  await tap(c, "t:flight");
  await tap(c, "c:0");
  await tap(c, "d:2026-10-04");
  const airline = lastChoice(c).options[0]!.title.replace(/ \d\d:\d\d$/, "");
  c.store.setPref(CLIENT, "avoid_airlines", [airline]);

  await c.click("m:new");
  await tap(c, "t:flight");
  await tap(c, "c:0");
  await tap(c, "d:2026-10-04");
  const again = lastChoice(c);
  assert.ok(again.options.every((o) => !o.title.startsWith(airline)), `no debe aparecer ${airline}`);
});

test("pasos caducados o de otro flujo no rompen nada: avisan y vuelven al menú", async () => {
  const c = setup();
  await c.text("hello");
  c.channel.clear();
  await c.click("o:0"); // sin flujo activo
  assert.match(textsOf(c)[0]!, /no longer active/);
  assert.equal(optionIds(lastChoice(c))[0], "m:new");

  c.channel.clear();
  await c.click("m:new");
  await c.click("d:2026-10-04"); // estamos en "tipo de viaje", no en fechas
  assert.match(textsOf(c).at(-1)!, /no longer active/);
});

test("fechas escritas a mano: formatos válidos, pasadas e inválidas", async () => {
  assert.equal(parseDate("2026-11-12", "2026-10-03"), "2026-11-12");
  assert.equal(parseDate("12/11/2026", "2026-10-03"), "2026-11-12");
  assert.equal(parseDate("12/11", "2026-10-03"), "2026-11-12");
  assert.equal(parseDate("1/2", "2026-10-03"), "2027-02-01", "sin año y ya pasada: el año siguiente");
  assert.equal(parseDate("2026-10-03", "2026-10-03"), null, "hoy no vale");
  assert.equal(parseDate("2026-02-30", "2026-10-03"), null);
  assert.equal(parseDate("tomorrow", "2026-10-03"), null);

  const c = setup();
  c.store.upsertUser(CLIENT);
  c.store.setPref(CLIENT, "home_airport", "RUH");
  await c.text("hello");
  await tap(c, "m:new");
  await tap(c, "t:flight");
  await tap(c, "c:0");
  await tap(c, "d:other");
  assert.match(textsOf(c).at(-1)!, /write the date/);
  await c.text("yesterday");
  assert.match(textsOf(c).at(-1)!, /could not read that date/);
  await c.text("2026-12-01");
  assert.match(lastChoice(c).body, /Flights from RUH to LHR/);
});

test("otro destino escrito: ciudad conocida, código y desconocida", async () => {
  const c = setup();
  c.store.upsertUser(CLIENT);
  c.store.setPref(CLIENT, "home_airport", "RUH");
  await c.text("hello");
  await tap(c, "m:new");
  await tap(c, "t:flight");
  await tap(c, "c:other");
  // Un sitio sin aeropuerto conocido ya no es un callejón sin salida: lo sigue la IA.
  c.llm.queue(say("Atlantis sounds fascinating. How would you like to travel, and what budget do you have in mind?"));
  await c.text("Atlantis");
  assert.match(textsOf(c).at(-1)!, /Atlantis sounds fascinating/);
  assert.equal(c.store.getWizard(CLIENT), null);
  await c.click("m:new");
  await tap(c, "t:flight");
  await tap(c, "c:other");
  await c.text("geneva");
  await tap(c, "d:2026-10-04");
  assert.match(lastChoice(c).body, /Flights from RUH to GVA/);
});

test("Plan any trip abre el planificador: el destino va en un recuadro de texto y se pasa a las siguientes preguntas", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  assert.match(textsOf(c).at(-1)!, /write the place/);
  await c.text("A weekend in Ronda by train");
  assert.match(textsOf(c).at(-1)!, /depart from/);
  await c.text("Malaga");
  assert.match(lastChoice(c).body, /purpose of the trip/);
});

test("Hablar con María avisa a María y no promete plazos", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:contact");
  assert.equal(c.alerts.length, 1);
  assert.equal(c.alerts[0]!.severity, "high");
  assert.match(textsOf(c).at(-1)!, /alerted Maria/);
  assert.doesNotMatch(textsOf(c).at(-1)!, /minutes|hours|immediately/i);
  assert.equal(c.store.listIncidents()[0]!.notified, true);
});

test("Mis reservas y Mis preferencias", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:book");
  assert.match(textsOf(c).at(-1)!, /no bookings yet/);
  await tap(c, "m:prefs");
  assert.match(textsOf(c).at(-1)!, /no saved preferences/);

  c.store.setPref(CLIENT, "home_airport", "RUH");
  c.store.setPref(CLIENT, "direct_only", true);
  c.store.setPref(CLIENT, "preferred_airlines", ["Saudia", "KLM"]);
  await tap(c, "m:prefs");
  const prefs = textsOf(c).at(-1)!;
  assert.match(prefs, /Home airport: RUH/);
  assert.match(prefs, /Direct flights only: yes/);
  assert.match(prefs, /Preferred airlines: Saudia, KLM/);

  await tap(c, "m:new");
  await tap(c, "t:flight");
  await tap(c, "c:0");
  await tap(c, "d:2026-10-04");
  await tap(c, "o:0");
  await c.click("m:book");
  assert.match(textsOf(c).at(-1)!, /waiting for your approval/);
});

test("escribir a mitad de un paso abandona el menú y atiende la IA", async () => {
  const c = setup();
  await startFull(c);
  c.llm.queue(say("Of course. What kind of spa are you looking for?"));
  await c.text("Actually, I want a hotel with a spa and a quiet room");
  assert.equal(c.llm.calls, 1);
  assert.equal(c.store.getWizard(CLIENT), null);
  c.channel.clear();
  await c.click("c:0"); // botón del paso anterior
  assert.match(textsOf(c)[0]!, /no longer active/);
});

test("'menu' vuelve al menú en cualquier momento y limpia el paso a medias", async () => {
  const c = setup();
  await startFull(c);
  c.channel.clear();
  await c.text("menu");
  assert.equal(optionIds(lastChoice(c))[0], "m:new");
  assert.equal(c.store.getWizard(CLIENT), null);
});

test("el menú sale en árabe cuando el cliente escribe en árabe", async () => {
  const c = setup();
  await c.text("مرحبا");
  await tap(c, "m:new");
  assert.deepEqual(lastChoice(c).options.map((o) => o.title), ["رحلة جوية", "فندق", "رحلة كاملة"]);
  await tap(c, "t:flight");
  await tap(c, "c:0");
  const dates = lastChoice(c);
  assert.match(dates.options[0]!.title, /^[^\d]*\d{1,2}/, "fecha con cifras occidentales y mes en árabe");
  assert.ok(dates.options.at(-1)!.title === "تاريخ آخر");
});

test("el botón de otro cliente no puede mover mi flujo", async () => {
  const c = setup();
  await startFull(c);
  c.store.upsertUser(OWNER);
  const before = c.store.getWizard(CLIENT);
  await c.click("c:0", OWNER); // OWNER no está en la lista de clientes autorizados
  assert.deepEqual(c.store.getWizard(CLIENT), before);
});
