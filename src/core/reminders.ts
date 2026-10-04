import type { Proposal, ReminderKind, Store } from "./store";

const HOUR = 3_600_000;

/** Cuánto antes se avisa de cada cosa. Las aerolíneas suelen abrir el check-in online unas 24 h antes, pero cada una fija su plazo. */
const LEAD: Record<ReminderKind, number> = {
  flight_checkin: 24 * HOUR,
  hotel_checkin: 24 * HOUR,
  hotel_checkout: 12 * HOUR,
};

const parse = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/**
 * Crea los recordatorios de una reserva ya confirmada. Si el aviso ya debería haber salido
 * pero el evento aún no ha pasado, se envía en el siguiente ciclo; si el evento ya pasó, no se crea.
 */
export function scheduleReminders(store: Store, p: Proposal, now: Date): number {
  const start = parse(p.attrs.starts_at);
  const end = parse(p.attrs.ends_at);
  const plan: { kind: ReminderKind; event: number | null }[] = [];
  if (p.kind === "flight") plan.push({ kind: "flight_checkin", event: start });
  if (p.kind === "hotel") {
    plan.push({ kind: "hotel_checkin", event: start });
    plan.push({ kind: "hotel_checkout", event: end });
  }
  let created = 0;
  for (const { kind, event } of plan) {
    if (event === null || event <= now.getTime()) continue;
    const due = Math.max(event - LEAD[kind], now.getTime());
    if (store.addReminder(p.userId, p.id, kind, new Date(due).toISOString())) created++;
  }
  return created;
}
