import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTripDates } from "../src/core/dates";

const T = "2026-10-06";
const ok = (s: string, from: string, nights?: number) => assert.deepEqual(parseTripDates(s, T), { from, ...(nights ? { nights } : {}) }, s);

test("fechas como las escribe una persona: rangos, meses con nombre y noches", () => {
  ok("del 12 al 15 de noviembre", "2026-11-12", 3);
  ok("Del 12 al 15 de Noviembre de 2026", "2026-11-12", 3);
  ok("12 de noviembre al 15 de noviembre", "2026-11-12", 3);
  ok("12-15 nov", "2026-11-12", 3);
  ok("12/11 - 15/11", "2026-11-12", 3);
  ok("12/11/2026 al 15/11/2026", "2026-11-12", 3);
  ok("2026-11-12 to 2026-11-15", "2026-11-12", 3);
  ok("2026-11-12 - 2026-11-15", "2026-11-12", 3);
  ok("12 to 15 November", "2026-11-12", 3);
  ok("November 12-15", "2026-11-12", 3);
  ok("Nov 12 to Nov 15", "2026-11-12", 3);
  ok("28 dic al 3 ene", "2026-12-28", 6);
  ok("12 nov, 3 noches", "2026-11-12", 3);
  ok("el 12 de noviembre", "2026-11-12");
  ok("2026-11-12", "2026-11-12");
  ok("12/11", "2026-11-12");
  ok("5 de octubre", "2027-10-05"); // ya pasó este año: el siguiente
});

test("fechas que no se entienden o no valen", () => {
  for (const bad of ["whenever", "mañana", "31/02", "del 15 al 12 de noviembre", "2026-10-01", "1 al 3", "12 nov, 99 noches"] ) {
    assert.equal(parseTripDates(bad, T), null, bad);
  }
});
