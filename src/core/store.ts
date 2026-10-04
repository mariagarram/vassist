import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Attrs, Lang, ProposalKind } from "./types";

export type User = { id: string; name: string | null; lang: Lang };
export type PlanStatus = "open" | "closing" | "rating" | "rated";
export type Plan = { id: string; userId: string; title: string; status: PlanStatus };
export type ProposalStatus = "pending" | "approved" | "rejected";
export type Proposal = {
  id: string;
  planId: string;
  userId: string;
  kind: ProposalKind;
  title: string;
  details: string;
  amountEur: number;
  attrs: Attrs;
  status: ProposalStatus;
  /** María ha confirmado la reserva con el proveedor. */
  confirmed: boolean;
};
export type SuggestionKey = "preferred_airlines" | "avoid_airlines" | "direct_only" | "hotel_min_stars";
export type Suggestion = {
  id: string;
  userId: string;
  key: SuggestionKey;
  value: string | number | boolean;
  evidence: { n: number; avg: number };
  status: "pending" | "accepted" | "rejected";
};
export type ElementRating = { kind: ProposalKind; attrs: Attrs; score: number };
export type ReminderKind = "flight_checkin" | "hotel_checkin" | "hotel_checkout";
export type Reminder = { id: string; userId: string; proposalId: string; kind: ReminderKind; dueAt: string; attempts: number };
export type Incident = { id: string; userId: string | null; severity: string; summary: string; notified: boolean };

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const newId = () => randomBytes(4).toString("hex");

export class Store {
  constructor(readonly db: DatabaseSync) {}

  private one(sql: string, ...args: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined;
  }
  private many(sql: string, ...args: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[];
  }
  private run(sql: string, ...args: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...args).changes);
  }

  // ---- usuarios ----
  upsertUser(id: string, name?: string): User {
    this.run("INSERT OR IGNORE INTO users (id, name, lang, created_at) VALUES (?, ?, 'en', ?)", id, name ?? null, now());
    if (name) this.run("UPDATE users SET name = ? WHERE id = ? AND name IS NULL", name, id);
    return this.getUser(id)!;
  }
  getUser(id: string): User | undefined {
    const r = this.one("SELECT id, name, lang FROM users WHERE id = ?", id);
    return r ? { id: String(r.id), name: (r.name as string | null) ?? null, lang: r.lang === "ar" ? "ar" : r.lang === "es" ? "es" : "en" } : undefined;
  }
  setLang(id: string, lang: Lang) {
    this.run("UPDATE users SET lang = ? WHERE id = ?", lang, id);
  }
  /** El cliente ha elegido idioma con los botones. */
  chooseLang(id: string, lang: Lang) {
    this.run("UPDATE users SET lang = ?, lang_set = 1 WHERE id = ?", lang, id);
  }
  langChosen(id: string): boolean {
    return Number(this.one("SELECT lang_set FROM users WHERE id = ?", id)?.lang_set ?? 0) === 1;
  }

  // ---- preferencias ----
  getPrefs(userId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.many("SELECT key, value FROM preferences WHERE user_id = ?", userId)) {
      out[String(r.key)] = JSON.parse(String(r.value));
    }
    return out;
  }
  /** Datos del viaje que se está planificando y respuestas que se recuerdan para el siguiente. */
  getTrip<T>(userId: string): T | null {
    const r = this.one("SELECT data FROM trips WHERE user_id = ?", userId);
    return r ? (JSON.parse(String(r.data)) as T) : null;
  }
  setTrip(userId: string, data: unknown) {
    this.run("INSERT INTO trips (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data", userId, JSON.stringify(data));
  }
  setPref(userId: string, key: string, value: unknown) {
    this.run(
      "INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
      userId,
      key,
      JSON.stringify(value),
    );
  }

  // ---- historial del agente ----
  getHistory(userId: string): Anthropic.MessageParam[] {
    const r = this.one("SELECT messages FROM history WHERE user_id = ?", userId);
    return r ? (JSON.parse(String(r.messages)) as Anthropic.MessageParam[]) : [];
  }
  saveHistory(userId: string, messages: Anthropic.MessageParam[]) {
    this.run(
      "INSERT INTO history (user_id, messages) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET messages = excluded.messages",
      userId,
      JSON.stringify(messages),
    );
  }

  /** true si el mensaje es nuevo; false si ya se había procesado (Meta reenvía webhooks). */
  markProcessed(messageId: string): boolean {
    return this.run("INSERT OR IGNORE INTO processed (id, at) VALUES (?, ?)", messageId, now()) === 1;
  }

  // ---- planes y propuestas ----
  private plan(r: Row): Plan {
    return { id: String(r.id), userId: String(r.user_id), title: String(r.title), status: r.status as PlanStatus };
  }
  getPlan(id: string): Plan | undefined {
    const r = this.one("SELECT * FROM plans WHERE id = ?", id);
    return r ? this.plan(r) : undefined;
  }
  openPlan(userId: string): Plan | undefined {
    const r = this.one("SELECT * FROM plans WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC, rowid DESC LIMIT 1", userId);
    return r ? this.plan(r) : undefined;
  }
  createPlan(userId: string, title: string): Plan {
    const id = newId();
    this.run("INSERT INTO plans (id, user_id, title, status, created_at) VALUES (?, ?, ?, 'open', ?)", id, userId, title, now());
    return this.getPlan(id)!;
  }
  setPlanStatus(id: string, status: PlanStatus) {
    this.run("UPDATE plans SET status = ? WHERE id = ?", status, id);
  }

  private proposal(r: Row): Proposal {
    return {
      id: String(r.id),
      planId: String(r.plan_id),
      userId: String(r.user_id),
      kind: r.kind as ProposalKind,
      title: String(r.title),
      details: String(r.details),
      amountEur: Number(r.amount_eur),
      attrs: JSON.parse(String(r.attrs)) as Attrs,
      status: r.status as ProposalStatus,
      confirmed: r.confirmed_at != null,
    };
  }
  createProposal(p: Omit<Proposal, "id" | "status" | "confirmed">): Proposal {
    const id = newId();
    this.run(
      "INSERT INTO proposals (id, plan_id, user_id, kind, title, details, amount_eur, attrs, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      id,
      p.planId,
      p.userId,
      p.kind,
      p.title,
      p.details,
      p.amountEur,
      JSON.stringify(p.attrs),
      now(),
    );
    return this.getProposal(id)!;
  }
  getProposal(id: string): Proposal | undefined {
    const r = this.one("SELECT * FROM proposals WHERE id = ?", id);
    return r ? this.proposal(r) : undefined;
  }
  /** Decide una propuesta pendiente del usuario. null si no existe, no es suya o ya estaba decidida. */
  decideProposal(id: string, userId: string, status: "approved" | "rejected"): Proposal | null {
    const changed = this.run(
      "UPDATE proposals SET status = ?, decided_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'",
      status,
      now(),
      id,
      userId,
    );
    return changed ? (this.getProposal(id) ?? null) : null;
  }
  /** Marca como confirmada (reservada con el proveedor) una propuesta aprobada. null si no procede. */
  confirmProposal(id: string): Proposal | null {
    const changed = this.run("UPDATE proposals SET confirmed_at = ? WHERE id = ? AND status = 'approved' AND confirmed_at IS NULL", now(), id);
    return changed ? (this.getProposal(id) ?? null) : null;
  }
  /** María no ha podido conseguirlo: la propuesta aprobada pasa a rechazada. null si no procede. */
  declineApproved(id: string): Proposal | null {
    const changed = this.run("UPDATE proposals SET status = 'rejected' WHERE id = ? AND status = 'approved' AND confirmed_at IS NULL", id);
    return changed ? (this.getProposal(id) ?? null) : null;
  }
  awaitingConfirmation(): (Proposal & { userName: string | null })[] {
    return this.many(
      "SELECT p.*, u.name AS user_name FROM proposals p JOIN users u ON u.id = p.user_id WHERE p.status = 'approved' AND p.confirmed_at IS NULL ORDER BY p.created_at, p.rowid",
    ).map((r) => ({ ...this.proposal(r), userName: (r.user_name as string | null) ?? null }));
  }

  // ---- recordatorios ----
  addReminder(userId: string, proposalId: string, kind: ReminderKind, dueAt: string): boolean {
    return this.run("INSERT OR IGNORE INTO reminders (id, user_id, proposal_id, kind, due_at) VALUES (?, ?, ?, ?, ?)", newId(), userId, proposalId, kind, dueAt) === 1;
  }
  dueReminders(nowIso: string, limit = 50): Reminder[] {
    return this.many("SELECT * FROM reminders WHERE sent_at IS NULL AND failed = 0 AND due_at <= ? ORDER BY due_at LIMIT ?", nowIso, limit).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      proposalId: String(r.proposal_id),
      kind: r.kind as ReminderKind,
      dueAt: String(r.due_at),
      attempts: Number(r.attempts),
    }));
  }
  listReminders(proposalId: string): (Reminder & { sent: boolean; failed: boolean })[] {
    return this.many("SELECT * FROM reminders WHERE proposal_id = ? ORDER BY due_at", proposalId).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      proposalId: String(r.proposal_id),
      kind: r.kind as ReminderKind,
      dueAt: String(r.due_at),
      attempts: Number(r.attempts),
      sent: r.sent_at != null,
      failed: Number(r.failed) === 1,
    }));
  }
  markReminderSent(id: string) {
    this.run("UPDATE reminders SET sent_at = ? WHERE id = ?", now(), id);
  }
  /** Cuenta un intento fallido; devuelve true si ya se agotaron y se da por fallido. */
  failReminderAttempt(id: string, maxAttempts = 3): boolean {
    this.run("UPDATE reminders SET attempts = attempts + 1 WHERE id = ?", id);
    const attempts = Number(this.one("SELECT attempts FROM reminders WHERE id = ?", id)?.attempts ?? 0);
    if (attempts < maxAttempts) return false;
    this.run("UPDATE reminders SET failed = 1 WHERE id = ?", id);
    return true;
  }

  pendingCount(planId: string): number {
    return Number(this.one("SELECT COUNT(*) AS c FROM proposals WHERE plan_id = ? AND status = 'pending'", planId)?.c ?? 0);
  }

  // ---- valoraciones ----
  /** Valoración global del plan (1-5). false si ya existía. */
  addGlobalRating(planId: string, userId: string, score: number): boolean {
    return (
      this.run("INSERT OR IGNORE INTO ratings (id, plan_id, user_id, proposal_id, score, created_at) VALUES (?, ?, ?, NULL, ?, ?)", newId(), planId, userId, score, now()) === 1
    );
  }
  /** Valoración de un elemento. score null = el cliente la ha saltado. false si ya existía. */
  addElementRating(proposal: Proposal, score: number | null): boolean {
    return (
      this.run(
        "INSERT OR IGNORE INTO ratings (id, plan_id, user_id, proposal_id, score, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        newId(),
        proposal.planId,
        proposal.userId,
        proposal.id,
        score,
        now(),
      ) === 1
    );
  }
  unratedApproved(planId: string): Proposal[] {
    return this.many(
      "SELECT p.* FROM proposals p WHERE p.plan_id = ? AND p.status = 'approved' AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.proposal_id = p.id) ORDER BY p.created_at, p.rowid",
      planId,
    ).map((r) => this.proposal(r));
  }
  globalRatings(userId: string): number[] {
    return this.many("SELECT score FROM ratings WHERE user_id = ? AND proposal_id IS NULL AND score IS NOT NULL", userId).map((r) => Number(r.score));
  }
  elementRatings(userId: string): ElementRating[] {
    return this.many(
      "SELECT p.kind, p.attrs, r.score FROM ratings r JOIN proposals p ON p.id = r.proposal_id WHERE r.user_id = ? AND r.score IS NOT NULL",
      userId,
    ).map((r) => ({ kind: r.kind as ProposalKind, attrs: JSON.parse(String(r.attrs)) as Attrs, score: Number(r.score) }));
  }

  // ---- sugerencias de preferencia ----
  private suggestion(r: Row): Suggestion {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      key: r.key as SuggestionKey,
      value: JSON.parse(String(r.value)) as Suggestion["value"],
      evidence: JSON.parse(String(r.evidence)) as Suggestion["evidence"],
      status: r.status as Suggestion["status"],
    };
  }
  /** Crea la sugerencia salvo que ya se hiciera antes (aceptada, rechazada o pendiente). */
  addSuggestion(userId: string, s: Pick<Suggestion, "key" | "value" | "evidence">): Suggestion | null {
    const value = JSON.stringify(s.value);
    if (this.one("SELECT 1 AS x FROM suggestions WHERE user_id = ? AND key = ? AND value = ?", userId, s.key, value)) return null;
    const id = newId();
    this.run(
      "INSERT INTO suggestions (id, user_id, key, value, evidence, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      id,
      userId,
      s.key,
      value,
      JSON.stringify(s.evidence),
      now(),
    );
    return this.getSuggestion(id)!;
  }
  getSuggestion(id: string): Suggestion | undefined {
    const r = this.one("SELECT * FROM suggestions WHERE id = ?", id);
    return r ? this.suggestion(r) : undefined;
  }
  decideSuggestion(id: string, userId: string, status: "accepted" | "rejected"): Suggestion | null {
    const changed = this.run("UPDATE suggestions SET status = ? WHERE id = ? AND user_id = ? AND status = 'pending'", status, id, userId);
    return changed ? (this.getSuggestion(id) ?? null) : null;
  }

  // ---- estado del menú guiado ----
  getWizard<T>(userId: string): T | null {
    const r = this.one("SELECT state FROM wizard WHERE user_id = ?", userId);
    return r ? (JSON.parse(String(r.state)) as T) : null;
  }
  setWizard(userId: string, state: unknown) {
    this.run("INSERT INTO wizard (user_id, state) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state", userId, JSON.stringify(state));
  }
  clearWizard(userId: string) {
    this.run("DELETE FROM wizard WHERE user_id = ?", userId);
  }
  /** Reservas del cliente (aprobadas o pendientes de aprobar), de la más reciente a la más antigua. */
  listProposals(userId: string): Proposal[] {
    return this.many("SELECT * FROM proposals WHERE user_id = ? AND status != 'rejected' ORDER BY created_at DESC, rowid DESC LIMIT 20", userId).map((r) => this.proposal(r));
  }
  /** Ciudades de destino de sus viajes anteriores, las más recientes primero y sin repetir. */
  recentCities(userId: string, limit = 4): string[] {
    const seen: string[] = [];
    for (const p of this.listProposals(userId)) {
      const city = p.attrs.city;
      if (typeof city === "string" && city && !seen.includes(city)) seen.push(city);
      if (seen.length >= limit) break;
    }
    return seen;
  }

  // ---- incidencias ----
  addIncident(userId: string | null, severity: string, summary: string): Incident {
    const id = newId();
    this.run("INSERT INTO incidents (id, user_id, severity, summary, notified, created_at) VALUES (?, ?, ?, ?, 0, ?)", id, userId, severity, summary, now());
    return { id, userId, severity, summary, notified: false };
  }
  markIncidentNotified(id: string) {
    this.run("UPDATE incidents SET notified = 1 WHERE id = ?", id);
  }
  listIncidents(): Incident[] {
    return this.many("SELECT * FROM incidents ORDER BY created_at, rowid").map((r) => ({
      id: String(r.id),
      userId: (r.user_id as string | null) ?? null,
      severity: String(r.severity),
      summary: String(r.summary),
      notified: Number(r.notified) === 1,
    }));
  }
}
