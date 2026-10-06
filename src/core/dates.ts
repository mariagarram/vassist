/**
 * Lee fechas escritas como las escribiría una persona: «del 12 al 15 de noviembre», «12/11 - 15/11»,
 * «2026-11-12 to 2026-11-15», «Nov 12-15», «12 nov, 3 noches». Devuelve la salida y, si hay rango o noches, la duración.
 */
const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};

type Part = { d: number; m?: number; y?: number };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const valid = (y: number, m: number, d: number) => {
  const t = new Date(`${iso(y, m, d)}T00:00:00Z`);
  return m >= 1 && m <= 12 && !Number.isNaN(t.getTime()) && t.getUTCDate() === d && t.getUTCMonth() + 1 === m;
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function parsePart(raw: string): Part | null {
  const t = raw.replace(/^(?:el|the|on|del|de|desde|from)\s+/, "").replace(/[.,]+$/, "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?$/.exec(t);
  if (m) return { d: Number(m[1]), m: Number(m[2]), ...(m[3] ? { y: Number(m[3]) } : {}) };
  m = /^(\d{1,2})(?:\s+de)?\s+([a-z]+)\.?(?:(?:\s+de)?\s+(\d{4}))?$/.exec(t);
  if (m && MONTHS[m[2]!]) return { d: Number(m[1]), m: MONTHS[m[2]!]!, ...(m[3] ? { y: Number(m[3]) } : {}) };
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(t);
  if (m && MONTHS[m[1]!]) return { d: Number(m[2]), m: MONTHS[m[1]!]!, ...(m[3] ? { y: Number(m[3]) } : {}) };
  m = /^(\d{1,2})$/.exec(t);
  if (m) return { d: Number(m[1]) };
  return null;
}

/** Fecha futura a partir de las partes. Sin año y ya pasada este año: el año siguiente. */
function resolve(p: Part, today: string, fallbackYear?: number): string | null {
  if (p.m === undefined) return null;
  const ty = Number(today.slice(0, 4));
  const y = p.y ?? fallbackYear ?? ty;
  if (!valid(y, p.m, p.d)) return null;
  const out = iso(y, p.m, p.d);
  if (out > today) return out;
  if (p.y === undefined && fallbackYear === undefined && valid(y + 1, p.m, p.d)) return iso(y + 1, p.m, p.d);
  return null;
}

export type TripDates = { from: string; nights?: number };

export function parseTripDates(text: string, today: string): TripDates | null {
  let t = norm(text);
  // «3 noches» o «3 nights» junto a una fecha
  let nights: number | undefined;
  const n = /(?:,|\bpor\b|\bfor\b|\by\b|\band\b)?\s*(\d{1,2})\s*(?:noches?|nights?)\b/.exec(t);
  if (n) {
    nights = Number(n[1]);
    t = t.replace(n[0], " ").replace(/\s+/g, " ").trim().replace(/[,;]+$/, "").trim();
  }
  if (nights !== undefined && (nights < 1 || nights > 60)) return null;

  const isoPair = /(\d{4}-\d{1,2}-\d{1,2}).{1,12}?(\d{4}-\d{1,2}-\d{1,2})/.exec(t);
  let a: Part | null;
  let b: Part | null = null;
  if (isoPair) {
    a = parsePart(isoPair[1]!);
    b = parsePart(isoPair[2]!);
  } else {
    const split = /^(.+?)\s*(?:-|–|—|→|\bto\b|\bal\b|\bhasta\b|\buntil\b|\bthru\b|\ba\b)\s*(.+)$/.exec(t.replace(/^(?:del|from|desde)\s+/, ""));
    if (split && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
      a = parsePart(split[1]!.trim());
      b = parsePart(split[2]!.trim());
      if (!a || !b) {
        a = parsePart(t);
        b = null;
      }
    } else a = parsePart(t);
  }
  if (!a) return null;

  if (!b) {
    const from = resolve(a, today);
    return from ? { from, ...(nights ? { nights } : {}) } : null;
  }
  // El mes y el año que falten en una parte se toman de la otra («del 12 al 15 de noviembre»).
  const m1 = a.m ?? b.m;
  const m2 = b.m ?? a.m;
  const y = a.y ?? b.y;
  const from = resolve({ d: a.d, m: m1, ...(y ? { y } : {}) }, today);
  if (!from) return null;
  const fy = Number(from.slice(0, 4));
  let to = m2 === undefined ? null : valid(fy, m2, b.d) ? iso(fy, m2, b.d) : null;
  if (to && to <= from && b.y === undefined) to = valid(fy + 1, m2!, b.d) ? iso(fy + 1, m2!, b.d) : null;
  if (!to) return null;
  const nts = days(from, to);
  if (nts < 1 || nts > 60) return null;
  return { from, nights: nts };
}
