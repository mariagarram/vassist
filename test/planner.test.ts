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
/** Pulsa la primera opción rápida (no «fechas exactas», «otro», «saltar» ni «hecho»). */
const quick = async (c: Ctx) => c.click(last(c).options.find((o) => !/:(o|s|d)$/.test(o.id))!.id);
const tap = async (c: Ctx, id: string) => {
  assert.ok(ids(c).includes(id), `no hay ${id} en ${ids(c).join(", ")}`);
  await c.click(id);
};
const texts = (c: Ctx) => c.channel.sent.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text);

/** Cliente nuevo hasta el panel del viaje: destino y origen por escrito, el resto por botones. */
async function toHub(c: Ctx, dest = "Granada", origin = "Malaga") {
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text(dest);
  await c.text(origin);
  await quick(c); // cuándo: en 3 días
  await pick(c, 1); // noches: 4
  await pick(c, 0); // viajeros: solo yo
}

test("planificador: solo 5 preguntas básicas y luego el panel del viaje con todo lo que se puede hacer", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  assert.match(texts(c).at(-1)!, /write the place/);
  await c.text("Vejer de la Frontera");
  assert.match(texts(c).at(-1)!, /depart from/);
  await c.text("Malaga");
  assert.match(last(c).body, /^3\/5 · When/);
  assert.equal(last(c).options[0]!.id, "p:2:o", "las fechas exactas van las primeras");
  await quick(c);
  await pick(c, 1);
  await pick(c, 0);
  const hub = last(c);
  assert.equal(hub.kind, "list");
  assert.deepEqual(ids(c), ["p:fl", "p:st", "p:go", "p:pf", "p:ch", "p:menu"]);
  assert.match(hub.body, /Destination: Vejer de la Frontera/);
  assert.match(hub.body, /Departing from: Malaga/);
  assert.match(hub.body, /Nights: 4 nights/);
  assert.equal(c.store.getWizard(CLIENT), null);
});

test("el siguiente viaje no repite lo ya sabido: origen y viajeros se recuerdan", async () => {
  const c = setup();
  await toHub(c);
  await tap(c, "p:menu");
  await tap(c, "m:plan");
  assert.ok(texts(c).some((x) => /usual details: from Malaga, Just me/.test(x)));
  assert.match(texts(c).at(-1)!, /write the place/);
  await c.text("Seville");
  assert.match(last(c).body, /^2\/3 · When/);
  await quick(c);
  await pick(c, 0);
  assert.match(last(c).body, /Destination: Seville/);
  assert.match(last(c).body, /Departing from: Malaga/);
});

test("fecha escrita a mano: se valida y se vuelve a pedir si no se entiende", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Granada");
  await c.text("Malaga");
  await tap(c, "p:2:o");
  await c.text("whenever");
  assert.match(texts(c).at(-1)!, /could not read that date/);
  await c.text("2026-12-01");
  assert.match(last(c).body, /^4\/5 · How many nights/);
  await tap(c, "p:3:o");
  await c.text("0");
  assert.match(texts(c).at(-1)!, /between 1 and 60/);
  await c.text("5");
  await pick(c, 0);
  assert.match(last(c).body, /Nights: 5/);
  assert.match(last(c).body, /When: 2026-12-01/);
});

test("vuelos: lista completa de aerolíneas con precio, ficha, Reservar y luego vuelo de vuelta", async () => {
  const c = setup();
  await toHub(c);
  await tap(c, "p:fl");
  const list = last(c);
  assert.match(list.body, /Flights from AGP to GRX on 2026-10-06/);
  const flights = list.options.filter((o) => o.id.startsWith("p:f:"));
  assert.equal(flights.length, 8, "ve todas las opciones, no solo tres");
  assert.ok(new Set(flights.map((o) => o.title.replace(/ \d\d:\d\d$/, ""))).size >= 6, "varias aerolíneas distintas");
  assert.match(list.body, /Showing 1 to 8 of 8/);
  assert.equal(list.options.at(-1)!.id, "p:hub");
  await c.click(flights[0]!.id);
  assert.deepEqual(ids(c), ["p:fk:0", "p:bl"]);
  await c.click("p:fk:0");
  const [p] = c.store.listProposals(CLIENT);
  assert.equal(p!.kind, "flight");
  assert.equal(p!.status, "approved");
  assert.match(c.alerts.at(-1)!.text, new RegExp(`/confirm ${p!.id}`));
  // el panel ofrece ahora el vuelo de vuelta
  assert.ok(ids(c).includes("p:rt"));
  await c.click("p:fk:0"); // segundo toque: no duplica
  assert.equal(c.store.listProposals(CLIENT).length, 1);
  await tap(c, "p:rt");
  assert.match(last(c).body, /Return flights from GRX to AGP on 2026-10-10/);
});

test("vuelos: ciudad sin aeropuerto conocido → avisa y vuelve al panel", async () => {
  const c = setup();
  await toHub(c, "Atlantis");
  await tap(c, "p:fl");
  assert.ok(texts(c).some((x) => /could not match an airport for Atlantis/.test(x)));
  assert.ok(ids(c).includes("p:fl"));
});

test("listas largas: ocho por página y «Más resultados»", async () => {
  const c = setup();
  const { providers } = await import("../src/core/providers");
  const orig = providers.searchHotels;
  providers.searchHotels = async ({ city }) =>
    Array.from({ length: 20 }, (_, i) => ({
      id: `HT-${i}`, name: `Hotel ${i} ${city}`, city, type: "hotel" as const, stars: 4, pricePerNightEur: 100 + i,
      freeCancellation: true, distanceToCenterKm: 1, onlineCheckin: true, digitalKey: false,
    }));
  try {
    await toHub(c);
    await tap(c, "p:st");
    assert.equal(last(c).options.filter((o) => o.id.startsWith("p:b:")).length, 8);
    assert.match(last(c).body, /Showing 1 to 8 of 20/);
    assert.ok(last(c).options.some((o) => o.title === "More results (12)"));
    await tap(c, "p:mo");
    assert.match(last(c).body, /Showing 9 to 16 of 20/);
    assert.equal(last(c).options[0]!.id, "p:b:8");
    await tap(c, "p:mo");
    assert.match(last(c).body, /Showing 17 to 20 of 20/);
    assert.ok(!ids(c).includes("p:mo"));
  } finally {
    providers.searchHotels = orig;
  }
});

test("hoteles y apartamentos: todo el inventario, tarjeta con foto y mapa, y «Reservar» avisa a María", async () => {
  const c = setup();
  await toHub(c);
  await tap(c, "p:st");
  const list = last(c);
  assert.equal(list.kind, "list");
  const stays = list.options.filter((o) => o.id.startsWith("p:b:"));
  assert.equal(stays.length, 8, "hoteles y apartamentos, no solo unos pocos");
  assert.ok(stays.some((o) => /Apartamento|Loft|Casa Patio/.test(o.title)), "debe incluir apartamentos");
  assert.match(JSON.stringify(list.options), /EUR \d+ per night/);
  await c.click(stays[0]!.id);
  assert.deepEqual(ids(c), ["p:bk:0", "p:bl"]);
  assert.equal(last(c).kind, "photo");
  assert.ok(c.channel.sent.some((s) => s.kind === "location"));
  assert.match(last(c).body, /Sample data/);
  await c.click("p:bk:0");
  const [proposal] = c.store.listProposals(CLIENT);
  assert.equal(proposal!.kind, "hotel");
  assert.equal(proposal!.status, "approved");
  assert.ok(String(proposal!.attrs.starts_at).includes("T15:00:00"));
  assert.match(c.alerts.at(-1)!.text, new RegExp(`/confirm ${proposal!.id}`));
  await c.click("p:bk:0");
  assert.equal(c.store.listProposals(CLIENT).length, 1);
});

test("cambiar datos: elige el campo, lo corrige y vuelve al panel", async () => {
  const c = setup();
  await toHub(c);
  await tap(c, "p:ch");
  assert.deepEqual(ids(c), ["p:c:destination", "p:c:origin", "p:c:when", "p:c:length", "p:c:travellers"]);
  await tap(c, "p:c:destination");
  await c.text("Seville");
  assert.match(last(c).body, /Destination: Seville/);
  assert.match(last(c).body, /Departing from: Malaga/);
});

test("preferencias opcionales: se pueden saltar y se recuerdan", async () => {
  const c = setup();
  await toHub(c);
  await tap(c, "p:pf");
  assert.match(last(c).body, /^1\/8 ·/);
  assert.ok(ids(c).some((x) => x.endsWith(":s")));
  await pick(c, 0);
  await pick(c, 0); // presupuesto
  await tap(c, "p:2:s"); // saltar el resto
  assert.ok(ids(c).includes("p:fl"), "vuelve al panel");
});

test("plan completo con la IA: usa los datos ya dados y no vuelve a preguntarlos", async () => {
  const c = setup();
  await toHub(c);
  c.llm.queue(say("Day 1: arrive in Granada. Estimated total: EUR 900."));
  await tap(c, "p:go");
  const sent = JSON.stringify(c.llm.requests.at(-1)!.messages.at(-1));
  assert.match(sent, /Trip details given by the client/);
  assert.match(sent, /Destination: Granada/);
  assert.match(sent, /do not ask for any of them again/);
  assert.deepEqual(ids(c), ["p:make", "p:adj", "p:hub"]);
  // más tarde, texto libre: la IA recibe los datos del viaje en su contexto
  c.llm.queue(say("Sure."));
  await c.text("is it safe there?");
  assert.match(c.llm.systems.at(-1)!, /known_trip_details[\s\S]*never ask for them again[\s\S]*Destination: Granada/);
  // «Crear propuestas» se lo pasa a la IA
  c.llm.queue(
    useTool("create_proposal", { kind: "transport", title: "Train Malaga to Granada", details: "approx 2h, estimate", amount_eur: 30, attrs: { mode: "train" } }),
    say("Prepared."),
  );
  await c.click("p:make");
  assert.equal(c.store.listProposals(CLIENT)[0]!.kind, "transport");
  await c.click("p:hub");
  assert.ok(ids(c).includes("p:fl"));
});

test("planificador: escribir texto libre lo abandona y lo atiende la IA", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Madrid");
  await c.text("Rome");
  c.llm.queue(say("Of course, a question for you."));
  await c.text("what about visas?");
  assert.match(texts(c).at(-1)!, /a question for you/);
  assert.equal(c.store.getWizard(CLIENT), null);
});

test("planificador en árabe: sale en árabe y los botones viejos no rompen nada", async () => {
  const c = setup();
  await c.text("مرحبا");
  await c.click("m:plan");
  assert.match(texts(c).at(-1)!, /اكتبوا اسم المكان/);
  await c.click("p:4:1"); // botón de otra pregunta: obsoleto
  assert.ok(texts(c).some((x) => /لم يعد متاحاً/.test(x)));
});

test("los botones de resultados caducados no rompen nada", async () => {
  const c = setup();
  await toHub(c);
  await c.click("p:b:3"); // sin lista de hoteles en pantalla
  assert.ok(texts(c).some((x) => /no longer available/.test(x)));
  assert.ok(ids(c).includes("p:fl"));
});

async function planUntilStays(c: Ctx) {
  await toHub(c);
  await tap(c, "p:st");
  await c.click("p:b:0");
}

test("reserva automática: «Reservar» confirma al momento, sin María, y programa recordatorios", async () => {
  const c = setup({ autoBook: true });
  await planUntilStays(c);
  await c.click("p:bk:0");
  const [p] = c.store.listProposals(CLIENT);
  assert.ok(p!.confirmed);
  assert.ok(texts(c).some((x) => /Booking confirmed[\s\S]*Reference: SIM-[\s\S]*TEST MODE/.test(x)));
  assert.equal(c.alerts.length, 0, "María no recibe nada si todo va bien");
  assert.ok(c.store.listReminders(p!.id).length >= 2, "check-in y check-out, más la fecha límite si hay cancelación gratuita");
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
  assert.ok(texts(c).some((x) => /could not complete the booking/.test(x)));
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

test("idioma: al empezar elige Español, English o العربية; el resto sale en el idioma elegido", async () => {
  const c = setup({ askLanguage: true });
  await c.text("hola");
  assert.deepEqual(ids(c), ["l:en", "l:es", "l:ar"]);
  assert.match((last(c) as { body: string }).body, /Elige tu idioma/);
  await c.click("l:es");
  assert.match(texts(c).at(-1)!, /Bienvenido a VASSIST/);
  assert.ok(ids(c).includes("m:lang"));
  await tap(c, "m:plan");
  assert.match(texts(c).at(-1)!, /Escriba el lugar/);
  await c.text("Granada");
  await c.text("Málaga");
  assert.match((last(c) as { body: string }).body, /¿Cuándo le gustaría viajar\?/);
  // escribir en español no cambia el idioma elegido
  await c.text("gracias por todo");
  assert.equal(c.store.getUser(CLIENT)!.lang, "es");
  // cambiar de idioma desde el menú
  await c.text("menú");
  await tap(c, "m:lang");
  await c.click("l:en");
  assert.equal(c.store.getUser(CLIENT)!.lang, "en");
  assert.ok(!texts(c).at(-1)!.includes("Bienvenido"), "la bienvenida solo se da la primera vez");
});

test("español: todas las preguntas del planificador están traducidas", async () => {
  const { untranslatedSpanish } = await import("../src/core/planner");
  assert.deepEqual(untranslatedSpanish(), []);
});

test("los clientes que ya existían no vuelven a ver el selector de idioma", async () => {
  const c = setup({ askLanguage: true });
  c.store.upsertUser(CLIENT, "Client");
  c.store.chooseLang(CLIENT, "en");
  await c.text("hello");
  assert.match((last(c) as { body: string }).body, /How can I help you today/);
  assert.ok(!ids(c).includes("l:es"));
});

test("fechas exactas escritas de una vez: se entienden y no se pregunta por las noches", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Granada");
  await c.text("Malaga");
  await tap(c, "p:2:o");
  assert.match(texts(c).at(-1)!, /for example 12 to 15 November/);
  await c.text("del 12 al 15 de noviembre");
  // salta directamente a viajeros (5.ª pregunta); no pregunta duración
  assert.match(last(c).body, /^5\/5 · Who is travelling/);
  await pick(c, 0);
  assert.match(last(c).body, /When: 2026-11-12/);
  assert.match(last(c).body, /Nights: 3/);
  // los vuelos usan esas fechas
  await tap(c, "p:fl");
  assert.match(last(c).body, /on 2026-11-12/);
  await tap(c, "p:hub");
  // cambiar solo las fechas actualiza también las noches
  await tap(c, "p:ch");
  await tap(c, "p:c:when");
  await tap(c, "p:0:o");
  await c.text("2026-12-01 to 2026-12-08");
  assert.match(last(c).body, /When: 2026-12-01/);
  assert.match(last(c).body, /Nights: 1 week/);
});

test("una sola fecha con noches: «12 nov, 3 noches»", async () => {
  const c = setup();
  await c.text("hello");
  await tap(c, "m:plan");
  await c.text("Granada");
  await c.text("Malaga");
  await tap(c, "p:2:o");
  await c.text("12 nov, 3 noches");
  assert.match(last(c).body, /^5\/5/);
});
