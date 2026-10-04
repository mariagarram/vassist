import { runAgent } from "./agent";
import { LANG_NAMES, LANG_PICK, T, detectLang } from "./i18n";
import { applySuggestion, deriveSuggestions } from "./insights";
import { providers as defaultProviders, type TravelProvider } from "./providers";
import { Menu } from "./menu";
import { Planner } from "./planner";
import { scheduleReminders } from "./reminders";
import type { Proposal, Store, User } from "./store";
import type { OutboxItem, ToolCtx } from "./tools";
import type { Channel, Incoming, Lang, Llm, OwnerNotifier } from "./types";

export type Deps = {
  store: Store;
  channel: Channel;
  llm: Llm;
  notifyOwner: OwnerNotifier;
  /** Números autorizados (solo dígitos). El resto se ignora. */
  allowed: Set<string>;
  providers?: TravelProvider;
  today?: () => string;
  /** Reloj inyectable para las pruebas. */
  now?: () => Date;
  /** Número de María (solo dígitos). Puede usar /confirm y /pending. */
  ownerPhone?: string;
  /**
   * Cómo escribir al cliente fuera de la ventana de 24 h de WhatsApp (plantilla aprobada).
   * Se usa solo si el texto libre falla.
   */
  sendOutside?: (to: string, text: string, lang: Lang) => Promise<void>;
  /** Nombre con el que el cliente ve a la propietaria en el menú. */
  ownerName?: string;
  /**
   * Vuelos y hoteles aprobados se reservan al momento con el proveedor, sin pasar por María; ella solo recibe
   * avisos si falla. El resto (restaurantes, guías, traslados, actividades...) lo gestiona ella con /confirm o /decline.
   */
  autoBook?: boolean;
  /** Al primer mensaje, el cliente elige idioma (Español / English / العربية) con botones. */
  askLanguage?: boolean;
};

/** Palabras con las que el cliente pide el menú. */
const MENU_WORDS = /^\/?(menu|menú|inicio|hi|hello|hey|hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|salam|salaam|good (morning|afternoon|evening)|القائمة|قائمة|مرحبا|مرحباً|أهلا|أهلاً|اهلا|السلام عليكم|صباح الخير|مساء الخير)[.!؟?\s]*$/i;

const MAX_TEXT = 3800;

/** Parte un texto largo en trozos aptos para WhatsApp (límite 4096). */
export function chunk(text: string): string[] {
  if (text.length <= MAX_TEXT) return [text];
  const parts: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if ((current + "\n\n" + para).length > MAX_TEXT && current) {
      parts.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) parts.push(current);
  return parts.flatMap((p) => (p.length <= MAX_TEXT ? [p] : (p.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT}}`, "g")) ?? [p])));
}

const isTrivial = (t: string) => t.trim().length <= 25 || /^\/?start$/i.test(t.trim());

export class Vassist {
  private queues = new Map<string, Promise<void>>();
  private menu: Menu;
  private planner: Planner;

  constructor(private d: Deps) {
    this.menu = new Menu({
      store: d.store,
      channel: d.channel,
      providers: d.providers ?? defaultProviders,
      now: () => this.now(),
      ownerName: d.ownerName ?? "Maria",
      sendApproval: (user, id) => this.sendApproval(user, id),
      askRating: (user, planId) => this.maybeAskRating(user, planId),
      alertOwner: (severity, text) => this.alert(severity, text),
    });
    this.planner = new Planner({
      store: d.store,
      channel: d.channel,
      now: () => this.now(),
      runBrief: async (user, brief) => {
        await this.runTurn(user, brief);
        await this.planner.afterPlan(user);
      },
      runText: (user, text) => this.runTurn(user, text),
      providers: d.providers ?? defaultProviders,
      approve: (user, id) => this.onReply(user, `ap:${id}`),
    });
  }

  /** Punto de entrada: un evento entrante de cualquier canal. */
  async handle(msg: Incoming): Promise<void> {
    if (this.isOwnerCommand(msg)) {
      if (!this.d.store.markProcessed(msg.id)) return;
      await this.onOwnerCommand(msg.text.trim()).catch((err) => console.error("[vassist] comando de propietaria:", err));
      return;
    }
    if (!this.d.allowed.has(msg.from)) {
      console.warn(`[vassist] mensaje ignorado de número no autorizado ${msg.from.slice(0, 4)}…`);
      return;
    }
    if (!this.d.store.markProcessed(msg.id)) return;
    // Un mensaje cada vez por usuario, para que el orden sea siempre coherente.
    const prev = this.queues.get(msg.from) ?? Promise.resolve();
    const next = prev.then(() => this.process(msg)).catch((err) => console.error("[vassist] error no controlado:", err));
    this.queues.set(msg.from, next);
    await next;
  }

  private isOwnerCommand(msg: Incoming): msg is Extract<Incoming, { kind: "text" }> {
    return !!this.d.ownerPhone && msg.from === this.d.ownerPhone && msg.kind === "text" && /^\/(confirm|decline|pending)\b/i.test(msg.text.trim());
  }

  /** /pending lista lo aprobado sin confirmar; /confirm ID marca la reserva hecha y avisa al cliente. */
  private async onOwnerCommand(text: string) {
    const { store, channel } = this.d;
    const owner = this.d.ownerPhone!;
    const [cmd = "", id = ""] = text.split(/\s+/);
    if (cmd.toLowerCase() === "/pending") {
      const list = store.awaitingConfirmation();
      return channel.sendText(
        owner,
        list.length
          ? "Pendientes de confirmar:\n" + list.map((p) => `${p.id} · ${p.userName ?? p.userId} · ${p.title} · EUR ${p.amountEur.toFixed(2)}`).join("\n")
          : "No hay nada pendiente de confirmar.",
      );
    }
    if (cmd.toLowerCase() === "/decline") {
      const d = id ? store.declineApproved(id) : null;
      if (!d) return channel.sendText(owner, "No encuentro una propuesta aprobada y sin confirmar con ese ID. Usa /pending para ver la lista.");
      const u = store.getUser(d.userId);
      if (u) await this.tell(u.id, T[u.lang].declined(d.title), u.lang);
      return channel.sendText(owner, `Marcado como no posible: ${d.title}. Cliente avisado.`);
    }
    const p = id ? store.confirmProposal(id) : null;
    if (!p) return channel.sendText(owner, "No encuentro una propuesta aprobada y sin confirmar con ese ID. Usa /pending para ver la lista.");
    const reminders = scheduleReminders(store, p, this.now());
    const user = store.getUser(p.userId);
    if (user) await this.tell(user.id, T[user.lang].confirmed(p.title), user.lang);
    const missing = reminders === 0 && (p.kind === "flight" || p.kind === "hotel") ? " Ojo: no tiene fechas válidas (starts_at/ends_at) o ya pasaron, así que no habrá recordatorios." : "";
    await channel.sendText(owner, `Confirmado: ${p.title}. Cliente avisado. Recordatorios programados: ${reminders}.${missing}`);
  }

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  /** Escribe al cliente. Si WhatsApp rechaza el texto libre (fuera de las 24 h), usa la plantilla. */
  private async tell(userId: string, text: string, lang: Lang) {
    try {
      await this.d.channel.sendText(userId, text);
    } catch (err) {
      if (!this.d.sendOutside) throw err;
      await this.d.sendOutside(userId, text, lang);
    }
  }

  /** Envía los recordatorios vencidos. Llamar cada minuto más o menos. */
  async tick(): Promise<void> {
    const { store } = this.d;
    for (const r of store.dueReminders(this.now().toISOString())) {
      const p = store.getProposal(r.proposalId);
      const user = store.getUser(r.userId);
      if (!p || !user) continue;
      try {
        await this.tell(user.id, T[user.lang].reminder(r.kind, p), user.lang);
        store.markReminderSent(r.id);
      } catch (err) {
        console.error("[vassist] recordatorio no enviado:", err);
        if (store.failReminderAttempt(r.id)) {
          const incident = store.addIncident(user.id, "high", `No se pudo enviar el recordatorio ${r.kind} de "${p.title}" a ${user.name ?? user.id}`);
          await this.alert("high", incident.summary, incident.id);
        }
      }
    }
  }

  private async process(msg: Incoming) {
    const { store, channel } = this.d;
    const isNew = !store.getUser(msg.from);
    const user = store.upsertUser(msg.from, msg.name);

    if (msg.kind === "reply") return this.onReply(user, msg.replyId);
    if (this.d.askLanguage && !store.langChosen(user.id)) return this.pickLanguage(user);
    if (msg.kind === "unsupported") return channel.sendText(user.id, T[user.lang].unsupported);

    const lang = detectLang(msg.text, user.lang);
    if (lang !== user.lang) store.setLang(user.id, lang);
    const current = { ...user, lang };

    const wantsMenu = MENU_WORDS.test(msg.text.trim());
    // La primera vez (o con /start) siempre se da la bienvenida, que incluye el aviso de que es una IA.
    if (isNew || /^\/?start$/i.test(msg.text.trim())) {
      await channel.sendText(user.id, T[lang].welcome);
      if (wantsMenu || isTrivial(msg.text)) return this.menu.show(current);
    } else if (wantsMenu) {
      return this.menu.show(current);
    } else if ((await this.planner.onText(current, msg.text)) || (await this.menu.onText(current, msg.text))) {
      return;
    }
    // Texto libre: lo atiende la IA y se abandona cualquier paso del menú a medias.
    store.clearWizard(user.id);
    await this.runTurn(current, msg.text);
  }

  private async pickLanguage(user: User) {
    await this.d.channel.sendButtons(user.id, LANG_PICK, (Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ id: `l:${l}`, title: LANG_NAMES[l] })));
  }

  private async runTurn(user: User, text: string) {
    const { store, channel } = this.d;
    const ctx: ToolCtx = {
      store,
      providers: this.d.providers ?? defaultProviders,
      userId: user.id,
      userName: user.name,
      notifyOwner: this.d.notifyOwner,
      outbox: [],
    };
    try {
      const today = this.d.today?.() ?? new Date().toISOString().slice(0, 10);
      const { reply, history } = await runAgent(this.d.llm, store.getHistory(user.id), text, ctx, user.lang, today);
      store.saveHistory(user.id, history);
      if (reply) for (const part of chunk(reply)) await channel.sendText(user.id, part);
      await this.flush(user, ctx.outbox);
    } catch (err) {
      console.error("[vassist] fallo del agente:", err);
      const incident = store.addIncident(user.id, "high", `Fallo del agente: ${err instanceof Error ? err.message : String(err)}`);
      await this.alert("high", `El asistente falló con ${user.name ?? user.id}: ${incident.summary}`, incident.id);
      await channel.sendText(user.id, T[user.lang].error).catch(() => {});
    }
  }

  private async alert(severity: "info" | "high" | "urgent", text: string, incidentId?: string): Promise<boolean> {
    try {
      await this.d.notifyOwner({ severity, text });
      if (incidentId) this.d.store.markIncidentNotified(incidentId);
      return true;
    } catch (err) {
      console.error("[vassist] no se pudo avisar a la propietaria:", err);
      return false;
    }
  }

  private async flush(user: User, outbox: OutboxItem[]) {
    for (const item of outbox) {
      if (item.type === "approval") await this.sendApproval(user, item.proposalId);
    }
    for (const item of outbox) {
      if (item.type === "plan_complete") await this.maybeAskRating(user, item.planId);
    }
  }

  /** Tras aprobar: reserva automática (vuelo u hotel) o petición a María (todo lo que necesita hablar con un lugar). */
  private async fulfil(user: User, p: Proposal) {
    const { store, channel } = this.d;
    const t = T[user.lang];
    const who = `${user.name ?? user.id} (${user.id})`;
    if (this.d.autoBook && (p.kind === "flight" || p.kind === "hotel")) {
      let result: Awaited<ReturnType<TravelProvider["book"]>>;
      try {
        result = await (this.d.providers ?? defaultProviders).book({ kind: p.kind, title: p.title, amountEur: p.amountEur, proposalId: p.id });
      } catch (err) {
        result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (result.ok) {
        const confirmed = store.confirmProposal(p.id);
        if (confirmed) scheduleReminders(store, confirmed, this.now());
        await channel.sendText(user.id, t.autoBooked(p.title, result.reference, result.simulated));
        return;
      }
      await channel.sendText(user.id, t.bookingFailed(p.title));
      await this.alert("high", `FALLO de reserva automática. Cliente ${who}: ${p.title} (EUR ${p.amountEur.toFixed(2)}). Motivo: ${result.reason}\nContacta al cliente. Si lo resuelves tú: /confirm ${p.id} o /decline ${p.id}`);
      return;
    }
    if (p.kind === "flight" || p.kind === "hotel") {
      await channel.sendText(user.id, t.approved(p.title));
      await this.alert("info", `Aprobado por ${who}: ${p.title} (EUR ${p.amountEur.toFixed(2)}). ${p.details}\nReserva con el proveedor y responde: /confirm ${p.id}`);
      return;
    }
    await channel.sendText(user.id, t.manualRequested(p.title));
    await this.alert(
      "high",
      `PETICIÓN para contactar con el lugar. Cliente ${who}: ${p.title} (EUR ${p.amountEur.toFixed(2)}). ${p.details}\nContacta con el lugar y responde: /confirm ${p.id} si queda hecho, o /decline ${p.id} si no es posible.`,
    );
  }

  private async sendApproval(user: User, proposalId: string) {
    const p = this.d.store.getProposal(proposalId);
    if (!p) return;
    const t = T[user.lang];
    await this.d.channel.sendButtons(user.id, t.proposalPrompt(p), [
      { id: `ap:${p.id}`, title: t.approve },
      { id: `rj:${p.id}`, title: t.reject },
    ]);
  }

  /** Pide la valoración cuando el plan está cerrado y no queda nada pendiente de aprobar. */
  private async maybeAskRating(user: User, planId: string) {
    const { store, channel } = this.d;
    const plan = store.getPlan(planId);
    if (!plan || plan.userId !== user.id || plan.status !== "closing" || store.pendingCount(plan.id) > 0) return;
    store.setPlanStatus(plan.id, "rating");
    const t = T[user.lang];
    await channel.sendList(
      user.id,
      t.rateAsk,
      t.rateLabel,
      t.scale.map((label, i) => ({ id: `rg:${plan.id}:${i + 1}`, title: `${i + 1} - ${label}` })),
    );
  }

  private async onReply(user: User, replyId: string) {
    const { store, channel } = this.d;
    const t = T[user.lang];
    const [kind = "", a = "", b = ""] = replyId.split(":");
    const score = Number(b);
    const validScore = Number.isInteger(score) && score >= 1 && score <= 5;

    switch (kind) {
      case "ap":
      case "rj": {
        const decided = store.decideProposal(a, user.id, kind === "ap" ? "approved" : "rejected");
        if (!decided) return channel.sendText(user.id, t.alreadyHandled);
        if (kind === "rj") await channel.sendText(user.id, t.rejected(decided.title));
        else await this.fulfil(user, decided);
        return this.maybeAskRating(user, decided.planId);
      }

      case "l": {
        if (!(a in LANG_NAMES)) return;
        const lang = a as Lang;
        const first = !store.langChosen(user.id);
        store.chooseLang(user.id, lang);
        const chosen = { ...user, lang };
        if (first) await channel.sendText(user.id, T[lang].welcome);
        return this.menu.show(chosen);
      }

      case "rg": {
        const plan = store.getPlan(a);
        if (!plan || plan.userId !== user.id || !validScore) return;
        if (!store.addGlobalRating(plan.id, user.id, score)) return;
        store.setPlanStatus(plan.id, "rated");
        if (store.unratedApproved(plan.id).length === 0) return this.finishRating(user);
        return channel.sendButtons(user.id, t.askElements, [
          { id: `ry:${plan.id}`, title: t.yes },
          { id: `rn:${plan.id}`, title: t.noThanks },
        ]);
      }

      case "ry": {
        const plan = store.getPlan(a);
        if (!plan || plan.userId !== user.id) return;
        return this.nextElement(user, plan.id);
      }

      case "rn": {
        const plan = store.getPlan(a);
        if (!plan || plan.userId !== user.id) return;
        return this.finishRating(user);
      }

      case "re":
      case "rs": {
        const p = store.getProposal(a);
        if (!p || p.userId !== user.id || p.status !== "approved") return;
        if (kind === "re" && !validScore) return;
        if (!store.addElementRating(p, kind === "re" ? score : null)) return;
        return this.nextElement(user, p.planId);
      }

      case "sy":
      case "sn": {
        const s = store.decideSuggestion(a, user.id, kind === "sy" ? "accepted" : "rejected");
        if (!s) return channel.sendText(user.id, t.alreadyHandled);
        if (kind === "sy") applySuggestion(store, s);
        return channel.sendText(user.id, kind === "sy" ? t.suggestionAccepted : t.suggestionDeclined);
      }

      default:
        if (replyId === "m:lang") return this.pickLanguage(user);
        if (replyId === "m:plan") return this.planner.start(user);
        if (await this.planner.onReply(user, replyId)) return;
        if (await this.menu.onReply(user, replyId)) return;
        console.warn("[vassist] respuesta de botón desconocida:", replyId);
    }
  }

  private async nextElement(user: User, planId: string) {
    const next = this.d.store.unratedApproved(planId)[0];
    if (!next) return this.finishRating(user);
    const t = T[user.lang];
    await this.d.channel.sendList(user.id, t.elementAsk(next.title), t.rateLabel, [
      ...t.scale.map((label, i) => ({ id: `re:${next.id}:${i + 1}`, title: `${i + 1} - ${label}` })),
      { id: `rs:${next.id}`, title: t.skip },
    ]);
  }

  private async finishRating(user: User) {
    const { store, channel } = this.d;
    const t = T[user.lang];
    await channel.sendText(user.id, t.thanks);
    for (const draft of deriveSuggestions(store, user.id)) {
      const s = store.addSuggestion(user.id, draft);
      if (!s) continue;
      await channel.sendButtons(user.id, t.suggestion(s), [
        { id: `sy:${s.id}`, title: t.suggestionYes },
        { id: `sn:${s.id}`, title: t.suggestionNo },
      ]);
    }
  }
}
