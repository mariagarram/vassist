import { parseDate } from "./menu";
import type { Store, User } from "./store";
import type { Channel, Lang, Row } from "./types";

/**
 * Planificador de viajes por menú: el cliente solo pulsa opciones (escribe únicamente destino, origen
 * u «otro»). Al terminar, el formulario completo se entrega a la IA, que redacta el plan y crea las propuestas.
 * Botones: "p:<pregunta>:<opción>" (índice de la opción, "o" otro, "d" hecho, "s" saltar el resto)
 * y "p:go", "p:redo", "p:cancel", "p:make", "p:adj".
 */
export interface PlannerHost {
  store: Store;
  channel: Channel;
  now(): Date;
  /** Entrega el formulario a la IA y muestra después los botones de crear propuestas / ajustar. */
  runBrief(user: User, brief: string): Promise<void>;
  /** Mensaje del cliente a la IA, tal cual. */
  runText(user: User, text: string): Promise<void>;
}

type L2 = { en: string; ar: string };
type Opt = { v: string } & L2;
type Ctx = { user: User; prefs: Record<string, unknown>; recent: string[] };
type Q = {
  key: string;
  /** Etiqueta del campo en el resumen. */
  name: L2;
  ask: L2;
  opts: (c: Ctx) => Opt[];
  /** Fila «otro»: abre una pregunta de texto. */
  other?: { label: L2; ask: L2; placeholder: L2 };
  multi?: boolean;
};

const o = (v: string, en: string, ar: string): Opt => ({ v, en, ar });

const QS: Q[] = [
  {
    key: "destination",
    name: { en: "Destination", ar: "الوجهة" },
    ask: { en: "Where would you like to go?", ar: "إلى أين تودون السفر؟" },
    opts: () => [],
    other: { label: { en: "Another place", ar: "وجهة أخرى" }, ask: { en: "Please write the place: any city, town, region or country.", ar: "اكتبوا اسم المكان: أي مدينة أو بلدة أو منطقة أو دولة." }, placeholder: { en: "City, town, region or country", ar: "مدينة أو بلدة أو منطقة أو دولة" } },
  },
  {
    key: "origin",
    name: { en: "Departing from", ar: "الانطلاق من" },
    ask: { en: "Where will you travel from?", ar: "من أين ستنطلقون؟" },
    opts: (c) => (typeof c.prefs.home_airport === "string" && c.prefs.home_airport ? [o(c.prefs.home_airport, `From ${c.prefs.home_airport}`, `من ${c.prefs.home_airport}`)] : []),
    other: { label: { en: "Another place", ar: "مكان آخر" }, ask: { en: "Please write the city or airport you will depart from.", ar: "اكتبوا المدينة أو المطار الذي ستنطلقون منه." }, placeholder: { en: "City or airport", ar: "المدينة أو المطار" } },
  },
  {
    key: "purpose",
    name: { en: "Purpose", ar: "الغرض" },
    ask: { en: "What is the purpose of the trip?", ar: "ما غرض الرحلة؟" },
    opts: () => [
      o("business", "Business", "عمل"),
      o("medical", "Medical", "علاج"),
      o("leisure", "Leisure", "ترفيه"),
      o("family", "Family", "عائلي"),
      o("event or conference", "Event or conference", "فعالية أو مؤتمر"),
    ],
  },
  {
    key: "when",
    name: { en: "When", ar: "الموعد" },
    ask: { en: "When would you like to travel?", ar: "متى تودون السفر؟" },
    opts: () => [
      o("this week", "This week", "هذا الأسبوع"),
      o("next week", "Next week", "الأسبوع القادم"),
      o("within a month", "Within a month", "خلال شهر"),
      o("in 2 to 3 months", "In 2 to 3 months", "خلال شهرين إلى ثلاثة"),
      o("flexible dates", "Flexible", "مواعيد مرنة"),
    ],
    other: { label: { en: "Exact date", ar: "تاريخ محدد" }, ask: { en: "Please write the departure date, for example 2026-11-12.", ar: "اكتبوا تاريخ المغادرة، مثل 2026-11-12." }, placeholder: { en: "2026-11-12", ar: "2026-11-12" } },
  },
  {
    key: "length",
    name: { en: "Length of stay", ar: "مدة الإقامة" },
    ask: { en: "How long will you stay?", ar: "كم ستدوم الرحلة؟" },
    opts: () => [
      o("1 to 2 days", "1 to 2 days", "يوم إلى يومين"),
      o("3 to 4 days", "3 to 4 days", "3 إلى 4 أيام"),
      o("5 to 7 days", "5 to 7 days", "5 إلى 7 أيام"),
      o("8 to 14 days", "8 to 14 days", "8 إلى 14 يوماً"),
      o("more than 2 weeks", "More than 2 weeks", "أكثر من أسبوعين"),
    ],
  },
  {
    key: "travellers",
    name: { en: "Travellers", ar: "المسافرون" },
    ask: { en: "Who is travelling?", ar: "من سيسافر؟" },
    opts: () => [
      o("just the client", "Just me", "أنا فقط"),
      o("2 adults", "2 adults", "شخصان بالغان"),
      o("family with children", "Family with children", "عائلة مع أطفال"),
      o("group of 3 to 5", "Group of 3 to 5", "مجموعة من 3 إلى 5"),
      o("group of 6 or more", "Group of 6 or more", "مجموعة من 6 أو أكثر"),
    ],
  },
  {
    key: "budget",
    name: { en: "Budget", ar: "الميزانية" },
    ask: { en: "What budget level do you have in mind?", ar: "ما مستوى الميزانية المناسب؟" },
    opts: () => [
      o("economy", "Economy", "اقتصادية"),
      o("comfortable", "Comfortable", "مريحة"),
      o("premium", "Premium", "مميزة"),
      o("luxury", "Luxury", "فاخرة"),
      o("no limit", "No limit", "بلا حد"),
    ],
    other: { label: { en: "Set an amount", ar: "تحديد مبلغ" }, ask: { en: "Please write your total budget with the currency, for example 3000 EUR.", ar: "اكتبوا إجمالي الميزانية مع العملة، مثل 3000 يورو." }, placeholder: { en: "For example 3000 EUR", ar: "مثال: 3000 يورو" } },
  },
  {
    key: "transport",
    name: { en: "Getting there", ar: "وسيلة السفر" },
    ask: { en: "How would you like to travel?", ar: "كيف تفضلون السفر؟" },
    opts: () => [
      o("plane", "Plane", "طائرة"),
      o("train", "Train", "قطار"),
      o("car, self-drive", "Car, I drive", "سيارة، أقودها بنفسي"),
      o("car with driver", "Car with driver", "سيارة مع سائق"),
      o("bus or ferry", "Bus or ferry", "حافلة أو عبّارة"),
      o("recommend the best option", "Recommend me", "اقترحوا الأنسب"),
    ],
  },
  {
    key: "lodging",
    name: { en: "Accommodation", ar: "الإقامة" },
    ask: { en: "What kind of accommodation?", ar: "أي نوع من الإقامة تفضلون؟" },
    opts: () => [
      o("3-star hotel", "Hotel 3 stars", "فندق 3 نجوم"),
      o("4-star hotel", "Hotel 4 stars", "فندق 4 نجوم"),
      o("5-star hotel", "Hotel 5 stars", "فندق 5 نجوم"),
      o("boutique hotel or apartment", "Boutique or apartment", "فندق بوتيك أو شقة"),
      o("no accommodation needed", "Not needed", "لا حاجة للإقامة"),
    ],
  },
  {
    key: "food",
    name: { en: "Food", ar: "الطعام" },
    ask: { en: "Any dietary requirements?", ar: "هل لديكم متطلبات غذائية؟" },
    opts: () => [
      o("no restrictions", "No restrictions", "بلا قيود"),
      o("halal", "Halal", "حلال"),
      o("vegetarian", "Vegetarian", "نباتي"),
      o("vegan", "Vegan", "نباتي صرف"),
    ],
    other: { label: { en: "Other", ar: "غير ذلك" }, ask: { en: "Please write your dietary requirements.", ar: "اكتبوا متطلباتكم الغذائية." }, placeholder: { en: "Your dietary requirements", ar: "متطلباتكم الغذائية" } },
  },
  {
    key: "interests",
    name: { en: "Interests", ar: "الاهتمامات" },
    ask: { en: "What do you enjoy? Choose up to 3, then press Done.", ar: "ما الذي تستمتعون به؟ اختاروا حتى 3 ثم اضغطوا تم." },
    multi: true,
    opts: () => [
      o("culture and history", "Culture and history", "الثقافة والتاريخ"),
      o("nature and outdoors", "Nature and outdoors", "الطبيعة والهواء الطلق"),
      o("shopping", "Shopping", "التسوق"),
      o("wellness and spa", "Wellness and spa", "العافية والسبا"),
      o("gastronomy", "Gastronomy", "فنون الطهي"),
      o("family activities", "Family activities", "أنشطة عائلية"),
      o("nightlife", "Nightlife", "الحياة الليلية"),
    ],
  },
  {
    key: "pace",
    name: { en: "Pace", ar: "الوتيرة" },
    ask: { en: "How full should the days be?", ar: "ما مدى امتلاء الأيام بالأنشطة؟" },
    opts: () => [o("relaxed", "Relaxed", "هادئة"), o("balanced", "Balanced", "متوازنة"), o("packed", "Packed", "مزدحمة")],
  },
  {
    key: "notes",
    name: { en: "Notes", ar: "ملاحظات" },
    ask: { en: "Anything else I should know?", ar: "هل هناك شيء آخر يجب أن أعرفه؟" },
    opts: () => [o("", "No, that is all", "لا، هذا كل شيء")],
    other: { label: { en: "Add a note", ar: "إضافة ملاحظة" }, ask: { en: "Please write your note.", ar: "اكتبوا ملاحظتكم." }, placeholder: { en: "Your note", ar: "ملاحظتكم" } },
  },
];

const TX = {
  en: {
    start: "Let us plan your trip. I will ask a few questions, just tap your answers.",
    other: "Other",
    done: "Done",
    skip: "Skip the rest",
    pick: "Choose",
    summary: "This is your trip brief:",
    go: "Create my plan",
    redo: "Start over",
    cancel: "Cancel",
    stale: "That option is no longer active. Please continue below.",
    working: "Thank you. I am preparing your plan, one moment please.",
    make: "Create proposals",
    adjust: "Adjust the plan",
    afterPlan: "What would you like to do with this plan?",
    adjustAsk: "Of course. Tell me what you would like to change, in your own words.",
    makeText: "Yes, please create the proposals for this plan.",
    notSet: "Not specified",
    cancelled: "Planner cancelled. Write \"menu\" whenever you need me.",
  },
  ar: {
    start: "لنخطط لرحلتكم. سأطرح بضعة أسئلة، وما عليكم سوى الضغط على إجاباتكم.",
    other: "غير ذلك",
    done: "تم",
    skip: "تخطي الباقي",
    pick: "اختاروا",
    summary: "هذا ملخص رحلتكم:",
    go: "أنشئوا الخطة",
    redo: "البدء من جديد",
    cancel: "إلغاء",
    stale: "هذا الخيار لم يعد متاحاً. تابعوا من الأسفل من فضلكم.",
    working: "شكراً لكم. أُعدّ خطتكم الآن، لحظة من فضلكم.",
    make: "إنشاء المقترحات",
    adjust: "تعديل الخطة",
    afterPlan: "ماذا تودون أن نفعل بهذه الخطة؟",
    adjustAsk: "بكل سرور. أخبروني بما تودون تغييره بكلماتكم.",
    makeText: "نعم، من فضلك أنشئ المقترحات لهذه الخطة.",
    notSet: "غير محدد",
    cancelled: "تم إلغاء المخطط. اكتبوا \"القائمة\" متى احتجتم إليّ.",
  },
} satisfies Record<Lang, Record<string, string>>;

type State = { planner: true; i: number; a: Record<string, string>; sel: string[]; awaiting?: boolean };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export class Planner {
  constructor(private h: PlannerHost) {}

  private ctx(user: User): Ctx {
    return { user, prefs: this.h.store.getPrefs(user.id), recent: this.h.store.recentCities(user.id) };
  }
  private today() {
    return this.h.now().toISOString().slice(0, 10);
  }

  async start(user: User) {
    this.h.store.setWizard(user.id, { planner: true, i: 0, a: {}, sel: [] } satisfies State);
    await this.h.channel.sendText(user.id, TX[user.lang].start);
    await this.ask(user);
  }

  private state(user: User): State | null {
    const w = this.h.store.getWizard<Partial<State>>(user.id);
    return w?.planner ? (w as State) : null;
  }

  /** Muestra la pregunta actual, o el resumen si ya no quedan. */
  private async ask(user: User) {
    const w = this.state(user);
    if (!w) return;
    const q = QS[w.i];
    if (!q) return this.summary(user, w);
    const tx = TX[user.lang];
    const lang = user.lang;
    const all = q.opts(this.ctx(user));
    // Sin opciones (p. ej. no hay aeropuerto guardado): se pregunta directamente por escrito.
    if (!all.length && q.other) {
      this.h.store.setWizard(user.id, { ...w, awaiting: true });
      await this.prompt(user, q);
      return;
    }
    const list: Row[] = all.flatMap((x, idx) => (w.sel.includes(x.v) ? [] : [{ id: `p:${w.i}:${idx}`, title: clip(x[lang], 24) }]));
    if (q.multi) list.unshift({ id: `p:${w.i}:d`, title: `✓ ${tx.done}${w.sel.length ? ` (${w.sel.length})` : ""}` });
    if (q.other && list.length < 10) list.push({ id: `p:${w.i}:o`, title: clip(q.other.label[lang], 24) });
    if (w.i >= 3 && list.length < 10) list.push({ id: `p:${w.i}:s`, title: tx.skip });
    await this.h.channel.sendList(user.id, `${w.i + 1}/${QS.length} · ${q.ask[lang]}`, tx.pick, list);
  }

  /** Pregunta abierta: con recuadro de respuesta si el canal lo permite. */
  private async prompt(user: User, q: Q) {
    const other = q.other;
    if (!other) return;
    if (this.h.channel.sendPrompt) await this.h.channel.sendPrompt(user.id, other.ask[user.lang], other.placeholder[user.lang]);
    else await this.h.channel.sendText(user.id, other.ask[user.lang]);
  }

  private label(q: Q, value: string, lang: Lang): string {
    // El resumen enseña la opción en el idioma del cliente cuando es una de las predefinidas.
    const found = q.opts({ user: { lang } as User, prefs: {}, recent: [] }).find((x) => x.v === value);
    return found ? found[lang] : value;
  }

  private async summary(user: User, w: State) {
    const tx = TX[user.lang];
    const lines = QS.map((q) => `• ${q.name[user.lang]}: ${w.a[q.key] ? this.label(q, w.a[q.key]!, user.lang) : tx.notSet}`);
    await this.h.channel.sendButtons(user.id, `${tx.summary}\n\n${lines.join("\n")}`, [
      { id: "p:go", title: tx.go },
      { id: "p:redo", title: tx.redo },
      { id: "p:cancel", title: tx.cancel },
    ]);
  }

  /** Texto escrito mientras el planificador espera «otro». false: no era para el planificador. */
  async onText(user: User, text: string): Promise<boolean> {
    const w = this.state(user);
    if (!w) return false;
    if (!w.awaiting) {
      // Texto libre en mitad del formulario: se abandona y lo atiende la IA.
      this.h.store.clearWizard(user.id);
      return false;
    }
    const q = QS[w.i];
    if (!q) return false;
    let value = clip(text.trim(), 200);
    if (q.key === "when") value = parseDate(value, this.today()) ?? value;
    await this.record(user, w, q, value);
    return true;
  }

  private async record(user: User, w: State, q: Q, value: string) {
    if (q.multi) {
      const sel = [...w.sel, value];
      if (sel.length < 3) {
        this.h.store.setWizard(user.id, { ...w, sel, awaiting: false });
        return this.ask(user);
      }
      return this.advance(user, { ...w, sel }, q, sel.join(", "));
    }
    return this.advance(user, w, q, value);
  }

  private async advance(user: User, w: State, q: Q, value: string) {
    const next: State = { ...w, a: { ...w.a, [q.key]: value }, i: w.i + 1, sel: [], awaiting: false };
    this.h.store.setWizard(user.id, next);
    await this.ask(user);
  }

  async onReply(user: User, replyId: string): Promise<boolean> {
    const parts = replyId.split(":");
    if (parts[0] !== "p") return false;
    const tx = TX[user.lang];
    const { store, channel } = this.h;
    const arg = parts[1] ?? "";

    if (arg === "make") {
      await this.h.runText(user, tx.makeText);
      return true;
    }
    if (arg === "adj") {
      await channel.sendText(user.id, tx.adjustAsk);
      return true;
    }
    if (arg === "cancel") {
      store.clearWizard(user.id);
      await channel.sendText(user.id, tx.cancelled);
      return true;
    }
    if (arg === "redo") {
      await this.start(user);
      return true;
    }

    const w = this.state(user);
    if (arg === "go") {
      if (!w) return this.stale(user);
      store.clearWizard(user.id);
      await channel.sendText(user.id, tx.working);
      await this.h.runBrief(user, this.brief(w, user.lang));
      return true;
    }

    const i = Number(arg);
    const opt = parts[2] ?? "";
    if (!w || !Number.isInteger(i) || i !== w.i) return this.stale(user);
    const q = QS[i];
    if (!q) return this.stale(user);

    if (opt === "s") {
      store.setWizard(user.id, { ...w, i: QS.length, sel: [], awaiting: false });
      await this.ask(user);
      return true;
    }
    if (opt === "o" && q.other) {
      store.setWizard(user.id, { ...w, awaiting: true });
      await this.prompt(user, q);
      return true;
    }
    if (opt === "d" && q.multi) {
      await this.advance(user, w, q, w.sel.join(", "));
      return true;
    }
    const chosen = q.opts(this.ctx(user))[Number(opt)];
    if (!chosen) return this.stale(user);
    await this.record(user, w, q, chosen.v);
    return true;
  }

  private async stale(user: User) {
    const tx = TX[user.lang];
    await this.h.channel.sendText(user.id, tx.stale);
    const w = this.state(user);
    if (w) await this.ask(user);
    return true;
  }

  /** Formulario completo para la IA, en inglés (la IA responde en el idioma del cliente). */
  private brief(w: State, lang: Lang): string {
    const lines = QS.map((q) => `- ${q.name.en}: ${w.a[q.key] || "not specified"}`);
    return [
      `[Trip planner form completed by the client with the menu. Reply language: ${lang}. Today is ${this.today()}. Do not ask these questions again.]`,
      ...lines,
      "",
      "Please write the plan now: route and mode, a short day-by-day outline (morning, afternoon, evening) with restaurant and activity suggestions that fit the interests, pace and food needs, and an estimated cost breakdown against the budget level (mark every figure as an estimate). Use the search tools for flights and hotels when they apply and an origin and date are clear. Ask a question only if something essential is missing. Keep it concise for a phone. Do not create proposals yet: the client will tap a button to confirm.",
    ].join("\n");
  }

  /** Botones tras el plan de la IA. */
  async afterPlan(user: User) {
    const tx = TX[user.lang];
    await this.h.channel.sendButtons(user.id, tx.afterPlan, [
      { id: "p:make", title: tx.make },
      { id: "p:adj", title: tx.adjust },
    ]);
  }
}
