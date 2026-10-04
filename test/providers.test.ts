import assert from "node:assert/strict";
import { test } from "node:test";
import { iataFor, cityFor, offsetFor } from "../src/core/providers";

test("iataFor entiende tildes, mayúsculas, nombres en español y ciudades sin aeropuerto propio", () => {
  assert.equal(iataFor("Málaga"), "AGP");
  assert.equal(iataFor("  CADIZ "), "XRY");
  assert.equal(iataFor("Vejer de la Frontera"), "XRY");
  assert.equal(iataFor("Londres"), "LHR");
  assert.equal(iataFor("lhr"), "LHR");
  assert.equal(iataFor("Atlantis"), null);
  assert.equal(cityFor("XRY"), "Jerez");
  assert.equal(offsetFor("RUH"), "+03:00");
});
