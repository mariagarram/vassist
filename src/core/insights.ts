import type { Store, Suggestion } from "./store";

/** Cuántas valoraciones coincidentes hacen falta antes de proponer un cambio. */
export const MIN_EVIDENCE = 3;

type Draft = Pick<Suggestion, "key" | "value" | "evidence">;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);

/**
 * Busca patrones en las valoraciones por elemento y devuelve cambios de
 * preferencia que proponer. Nunca modifica nada: el cliente debe confirmar.
 */
export function deriveSuggestions(store: Store, userId: string): Draft[] {
  const ratings = store.elementRatings(userId);
  const prefs = store.getPrefs(userId);
  const out: Draft[] = [];

  const flights = ratings.filter((r) => r.kind === "flight");

  const byAirline = new Map<string, number[]>();
  for (const f of flights) {
    const airline = f.attrs.airline;
    if (typeof airline !== "string" || !airline.trim()) continue;
    byAirline.set(airline, [...(byAirline.get(airline) ?? []), f.score]);
  }
  for (const [airline, scores] of byAirline) {
    const avg = mean(scores);
    const high = scores.filter((s) => s >= 4).length;
    const low = scores.filter((s) => s <= 2).length;
    if (high >= MIN_EVIDENCE && avg >= 4 && !asList(prefs.preferred_airlines).includes(airline.toLowerCase())) {
      out.push({ key: "preferred_airlines", value: airline, evidence: { n: high, avg: round1(avg) } });
    } else if (low >= MIN_EVIDENCE && avg <= 2.5 && !asList(prefs.avoid_airlines).includes(airline.toLowerCase())) {
      out.push({ key: "avoid_airlines", value: airline, evidence: { n: low, avg: round1(avg) } });
    }
  }

  const direct = flights.filter((f) => f.attrs.stops === 0).map((f) => f.score);
  if (direct.filter((s) => s >= 4).length >= MIN_EVIDENCE && mean(direct) >= 4 && prefs.direct_only !== true) {
    out.push({ key: "direct_only", value: true, evidence: { n: direct.filter((s) => s >= 4).length, avg: round1(mean(direct)) } });
  }

  const goodHotels = ratings.filter((r) => r.kind === "hotel" && r.score >= 4 && typeof r.attrs.stars === "number");
  if (goodHotels.length >= MIN_EVIDENCE) {
    const minStars = Math.min(...goodHotels.map((h) => h.attrs.stars as number));
    if (minStars >= 4 && Number(prefs.hotel_min_stars ?? 0) < minStars) {
      out.push({ key: "hotel_min_stars", value: minStars, evidence: { n: goodHotels.length, avg: round1(mean(goodHotels.map((h) => h.score))) } });
    }
  }

  return out;
}

/** Aplica una sugerencia ya confirmada por el cliente. */
export function applySuggestion(store: Store, s: Suggestion) {
  const prefs = store.getPrefs(s.userId);
  if (s.key === "preferred_airlines" || s.key === "avoid_airlines") {
    const current = Array.isArray(prefs[s.key]) ? (prefs[s.key] as string[]) : [];
    store.setPref(s.userId, s.key, [...current, String(s.value)]);
  } else {
    store.setPref(s.userId, s.key, s.value);
  }
}
