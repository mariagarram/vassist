import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT, say, setup, useTool, type Sent } from "./helpers";

type Ctx = ReturnType<typeof setup>;

const buttonsOf = (s: Sent) => (s.kind === "buttons" || s.kind === "list" ? s.options : []);

/** Busca entre lo enviado el mensaje de sugerencia (con botones sy:/sn:) cuyo texto coincide. */
const suggestionMsg = (c: Ctx, re: RegExp) =>
  c.channel.sent.find((s): s is Extract<Sent, { kind: "buttons" }> => s.kind === "buttons" && s.options[0]?.id.startsWith("sy:") === true && re.test(s.body));

/** Un plan completo: propuesta de vuelo, aprobación, cierre y valoraciones. Devuelve el último mensaje enviado. */
async function fullPlan(c: Ctx, airline: string, flightScore: number, globalScore = 5) {
  c.channel.clear();
  c.llm.queue(
    useTool("create_proposal", { kind: "flight", title: `Flight ${airline}`, details: "RUH-LHR", amount_eur: 400, attrs: { airline, stops: 0 } }),
    say("I have prepared it for your approval."),
  );
  await c.text("Please book the Saudia flight");
  const approval = c.channel.last();
  assert.equal(approval.kind, "buttons");
  await c.click(buttonsOf(approval)[0]!.id);

  c.llm.queue(useTool("complete_plan", {}), say("Wonderful. I will ask for your feedback shortly."));
  await c.text("That is everything, thank you");
  const rating = c.channel.last();
  assert.equal(rating.kind, "list", "debe pedir la valoración global");
  await c.click(buttonsOf(rating).find((o) => o.id.endsWith(`:${globalScore}`))!.id);
  const ask = c.channel.last();
  assert.equal(ask.kind, "buttons", "debe ofrecer valorar elementos");
  await c.click(buttonsOf(ask)[0]!.id);
  const element = c.channel.last();
  assert.equal(element.kind, "list");
  await c.click(buttonsOf(element).find((o) => o.id.endsWith(`:${flightScore}`))!.id);
  return c.channel.last();
}

test("un cliente nuevo recibe la bienvenida con aviso de IA, en inglés", async () => {
  const c = setup();
  await c.text("Hello");
  assert.equal(c.channel.sent.length, 2, "bienvenida y menú");
  const first = c.channel.sent[0]!;
  assert.ok(first.kind === "text" && /AI assistant, not a person/.test(first.text));
  assert.equal(c.channel.sent[1]!.kind, "list");
  assert.equal(c.llm.calls, 0, "un saludo corto no gasta llamadas al modelo");
});

test("en árabe: bienvenida en árabe y el modelo recibe reply_language: ar", async () => {
  const c = setup();
  await c.text("مرحبا");
  assert.ok(c.channel.sent[0]!.kind === "text" && /مساعدكم الشخصي للسفر/.test((c.channel.sent[0] as { text: string }).text));
  const menu = c.channel.last();
  assert.ok(menu.kind === "list" && menu.options[0]!.title === "رحلات وفنادق", "el menú sale en árabe");
  c.llm.queue(say("بالتأكيد، من أي مدينة ستسافرون؟"));
  await c.text("أريد السفر إلى لندن الأسبوع القادم");
  assert.match(c.llm.systems[0]!, /reply_language: ar/);
  assert.equal(c.store.getUser(CLIENT)!.lang, "ar");
});

test("la primera frase larga se contesta además de dar la bienvenida", async () => {
  const c = setup();
  c.llm.queue(say("Certainly. From which airport will you depart?"));
  await c.text("I need to fly to London next Friday for a conference");
  assert.equal(c.channel.sent.length, 2);
  assert.equal(c.llm.calls, 1);
});

test("números no autorizados se ignoran y mensajes repetidos no se procesan dos veces", async () => {
  const c = setup();
  await c.text("Hello", "34999999999");
  assert.equal(c.channel.sent.length, 0);
  assert.equal(c.store.getUser("34999999999"), undefined);

  const msg = { id: "dup-1", from: CLIENT, kind: "text" as const, text: "Hello" };
  await c.app.handle(msg);
  await c.app.handle(msg);
  assert.equal(c.channel.sent.length, 2, "bienvenida y menú, una sola vez");
});

test("el audio no se procesa: se pide texto", async () => {
  const c = setup();
  await c.app.handle({ id: "a1", from: CLIENT, kind: "unsupported" });
  assert.ok(c.channel.last().kind === "text" && /writing/.test((c.channel.last() as { text: string }).text));
});

test("aprobar avisa a María, no promete reserva ni cobro, y no se puede aprobar dos veces", async () => {
  const c = setup();
  c.llm.queue(useTool("create_proposal", { kind: "hotel", title: "Hotel Mirador", details: "3 nights", amount_eur: 900 }), say("Prepared."));
  await c.text("I choose the Mirador hotel please");
  const approval = c.channel.last();
  const [approve] = buttonsOf(approval);
  await c.click(approve!.id);
  const confirm = c.channel.last();
  assert.ok(confirm.kind === "text" && /Nothing has been charged/.test(confirm.text));
  assert.equal(c.alerts.length, 1);
  assert.match(c.alerts[0]!.text, /Hotel Mirador/);

  await c.click(approve!.id);
  assert.ok(c.channel.last().kind === "text" && /already been handled/.test((c.channel.last() as { text: string }).text));
  assert.equal(c.alerts.length, 1, "no se avisa dos veces");
});

test("un cliente no puede pulsar los botones de otro", async () => {
  const c = setup();
  c.llm.queue(useTool("create_proposal", { kind: "other", title: "Transfer", details: "airport", amount_eur: 80 }), say("Prepared."));
  await c.text("Please arrange the transfer");
  const id = buttonsOf(c.channel.last())[0]!.id;
  const intruder = "966500000002";
  const store = c.store;
  store.upsertUser(intruder);
  assert.equal(store.decideProposal(id.split(":")[1]!, intruder, "approved"), null);
});

test("no pide valoración mientras queden aprobaciones pendientes", async () => {
  const c = setup();
  c.llm.queue(
    useTool("create_proposal", { kind: "flight", title: "F1", details: "d", amount_eur: 100, attrs: { airline: "Saudia" } }),
    useTool("create_proposal", { kind: "hotel", title: "H1", details: "d", amount_eur: 100, attrs: { stars: 5 } }),
    useTool("complete_plan", {}),
    say("All prepared."),
  );
  await c.text("Flight and hotel please, that is all");
  assert.ok(!c.channel.sent.some((s) => s.kind === "list"), "aún no hay valoración");
  const approvals = c.channel.sent.filter((s) => s.kind === "buttons");
  assert.equal(approvals.length, 2);
  await c.click(buttonsOf(approvals[0]!)[0]!.id);
  assert.ok(!c.channel.sent.some((s) => s.kind === "list"), "sigue habiendo una pendiente");
  await c.click(buttonsOf(approvals[1]!)[1]!.id);
  assert.ok(c.channel.sent.some((s) => s.kind === "list"), "al decidir la última se pide la valoración");
});

test("valoración global obligatoria (1-5) y por elementos opcional (se puede saltar)", async () => {
  const c = setup();
  c.llm.queue(useTool("create_proposal", { kind: "flight", title: "F1", details: "d", amount_eur: 100, attrs: { airline: "Saudia" } }), say("ok"));
  await c.text("Choose the Saudia flight please");
  await c.click(buttonsOf(c.channel.last())[0]!.id);
  c.llm.queue(useTool("complete_plan", {}), say("done"));
  await c.text("Nothing else, thank you");
  const rating = c.channel.last();
  assert.deepEqual(buttonsOf(rating).map((o) => o.id.split(":")[2]), ["1", "2", "3", "4", "5"]);
  await c.click(buttonsOf(rating)[3]!.id);
  assert.deepEqual(c.store.globalRatings(CLIENT), [4]);

  await c.click(buttonsOf(c.channel.last())[0]!.id); // sí, valorar elementos
  const element = c.channel.last();
  const skip = buttonsOf(element).find((o) => o.id.startsWith("rs:"))!;
  await c.click(skip.id);
  assert.deepEqual(c.store.elementRatings(CLIENT), [], "saltar no guarda nota");
  assert.ok(c.channel.last().kind === "text" && /Thank you for your feedback/.test((c.channel.last() as { text: string }).text));

  // pulsar dos veces la misma valoración no duplica
  await c.click(rating.kind === "list" ? rating.options[0]!.id : "");
  assert.deepEqual(c.store.globalRatings(CLIENT), [4]);
});

test("tras 3 valoraciones altas de la misma aerolínea se propone cambiar la preferencia, y solo se aplica al confirmar", async () => {
  const c = setup();
  await fullPlan(c, "Saudia", 5);
  await fullPlan(c, "Saudia", 5);
  assert.deepEqual(c.store.getPrefs(CLIENT), {}, "con 2 valoraciones no se propone nada");

  await fullPlan(c, "Saudia", 5);
  const airlineMsg = suggestionMsg(c, /Saudia/);
  assert.ok(airlineMsg, "propone añadir Saudia");
  assert.ok(suggestionMsg(c, /direct flights/), "y, al ser todos directos, también solo vuelos directos");
  assert.deepEqual(c.store.getPrefs(CLIENT), {}, "no se aplica nada sin confirmación");

  await c.click(buttonsOf(airlineMsg)[0]!.id);
  assert.deepEqual(c.store.getPrefs(CLIENT), { preferred_airlines: ["Saudia"] });
});

test("si el cliente rechaza una sugerencia, no se vuelve a proponer", async () => {
  const c = setup();
  await fullPlan(c, "Saudia", 5);
  await fullPlan(c, "Saudia", 5);
  await fullPlan(c, "Saudia", 5);
  await c.click(buttonsOf(suggestionMsg(c, /Saudia/)!)[1]!.id); // no a la aerolínea
  await c.click(buttonsOf(suggestionMsg(c, /direct flights/)!)[1]!.id); // no a solo directos
  assert.deepEqual(c.store.getPrefs(CLIENT), {});

  const next = await fullPlan(c, "Saudia", 5);
  assert.ok(next.kind === "text" && /Thank you for your feedback/.test(next.text), "no hay ninguna sugerencia nueva");
});

test("el patrón de notas bajas propone evitar la aerolínea", async () => {
  const c = setup();
  await fullPlan(c, "Ryanair", 1);
  await fullPlan(c, "Ryanair", 2);
  await fullPlan(c, "Ryanair", 1);
  const msg = suggestionMsg(c, /poorly/);
  assert.ok(msg, "propone evitar Ryanair");
  await c.click(buttonsOf(msg)[0]!.id);
  assert.deepEqual(c.store.getPrefs(CLIENT), { avoid_airlines: ["Ryanair"] });
});

test("si el agente falla: avisa a María, registra la incidencia y el cliente recibe una disculpa", async () => {
  const c = setup();
  await c.text("Hello"); // bienvenida
  c.channel.clear();
  await c.text("I need a flight to Paris next week please"); // sin guion => el modelo simulado lanza error
  assert.equal(c.alerts.length, 1);
  assert.equal(c.alerts[0]!.severity, "high");
  assert.equal(c.store.listIncidents().length, 1);
  assert.ok(c.store.listIncidents()[0]!.notified);
  assert.ok(c.channel.last().kind === "text" && /something went wrong/.test((c.channel.last() as { text: string }).text));
});

test("report_incident urgente avisa a María en el acto", async () => {
  const c = setup();
  c.llm.queue(useTool("report_incident", { severity: "urgent", summary: "Flight SV123 cancelled, client at the airport" }), say("I have alerted the team."));
  await c.text("My flight has been cancelled and I am at the airport!");
  assert.equal(c.alerts.length, 1);
  assert.equal(c.alerts[0]!.severity, "urgent");
  assert.match(c.alerts[0]!.text, /SV123/);
});

test("los textos largos se parten para respetar el límite de WhatsApp", async () => {
  const { chunk } = await import("../src/core/handler");
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ` + "x".repeat(150)).join("\n\n");
  const parts = chunk(long);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 4096));
  assert.equal(parts.join("\n\n").replace(/\s+/g, ""), long.replace(/\s+/g, ""));
});
