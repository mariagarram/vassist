import { T, type MenuTexts } from "./i18n";
import { cityFor, iataFor, offsetFor, type FlightOption, type HotelOption, type TravelProvider } from "./providers";
import type { Store, User } from "./store";
import type { Attrs, Channel, Lang } from "./types";

/** Lo que el menú necesita del resto de la aplicación. */
export interface MenuHost {
  store: Store;
  channel: Channel;
  providers: TravelProvider;
  now(): Date;
  ownerName: string;
  sendApproval(user: User, proposalId: string): Promise<void>;
  askRating(user: User, planId: string): Promise<void>;
  /** true si el aviso llegó a María. */
  alertOwner(severity: "info" | "high" | "urgent", text: string): Promise<boolean>;
}

type Step = "type" | "dest" | "dest_text" | "nights" | "nights_text" | "date" | "date_text" | "origin_text" | "pick_flight" | "pick_hotel" | "return_ask" | "pick_return";
type Opt = { kind: "flight" | "hotel"; title: string; details: string; amountEur: number; attrs: Attrs };
type Wiz = {
  step: Step;
  type?: "flight" | "hotel" | "full";
  destCity?: string;
  destIata?: string;
  dests?: string[];
  nights?: number;
  date?: string;
  origin?: string;
  options?: Opt[];
  planId?: string;
};

/** Prefijos de los botones del menú. Los demás (ap, rj, rg, re, rs, ry, rn, sy, sn) son de otros flujos. */
const MENU_KINDS = new Set(["m", "t", "c", "n", "d", "o", "r"]);
const DEFAULT_DESTS = ["London", "Paris", "Zurich", "New York"];

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const cap = (s: string) => s.trim().replace(/\b\p{L}/gu, (m) => m.toUpperCase());

/** Acepta 2026-11-12, 12/11/2026 y 12/11 (año en curso o el siguiente). null si no se entiende o ya pasó. */
export function parseDate(text: string, today: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(t))) {
    d = Number(mt[1]);
    m = Number(mt[2]);
    y = mt[3] ? Number(mt[3]) : Number(today.slice(0, 4));
  } else return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== d || check.getUTCMonth() + 1 !== m) return null;
  if (iso > today) return iso;
  // "12/11" sin año y ya pasado este año: se entiende el año siguiente.
  if (mt && !mt[3]) {
    const next = `${y + 1}-${iso.slice(5)}`;
    return next > today ? next : null;
  }
  return null;
}

export class Menu {
  constructor(private h: MenuHost) {}

  private t(lang: Lang): MenuTexts {
    return T[lang].menu;
  }
  private today() {
    return isoDay(this.h.now());
  }
  private fmtDate(iso: string, lang: Lang) {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  }
  private money = (n: number) => `EUR ${n.toFixed(0)}`;

  /** Menú principal. */
  async show(user: User) {
    this.h.store.clearWizard(user.id);
    const m = this.t(user.lang);
    await this.h.channel.sendList(user.id, m.main, m.mainLabel, [
      { id: "m:new", title: m.rowNew },
      { id: "m:book", title: m.rowBookings },
      { id: "m:prefs", title: m.rowPrefs },
      { id: "m:contact", title: m.rowContact(this.h.ownerName) },
    ]);
  }

  /** Texto escrito mientras el menú espera un dato. true si lo ha consumido. */
  async onText(user: User, text: string): Promise<boolean> {
    const w = this.h.store.getWizard<Wiz>(user.id);
    if (!w) return false;
    const m = this.t(user.lang);
    switch (w.step) {
      case "dest_text": {
        const iata = iataFor(text);
        if (!iata) {
          await this.h.channel.sendText(user.id, m.destBad);
          return true;
        }
        await this.afterDest(user, w, /^[A-Za-z]{3}$/.test(text.trim()) ? cityFor(iata) : cap(text), iata);
        return true;
      }
      case "nights_text": {
        const n = Number(text.trim());
        if (!Number.isInteger(n) || n < 1 || n > 30) {
          await this.h.channel.sendText(user.id, m.nightsBad);
          return true;
        }
        await this.afterNights(user, w, n);
        return true;
      }
      case "date_text": {
        const d = parseDate(text, this.today());
        if (!d) {
          await this.h.channel.sendText(user.id, m.dateBad);
          return true;
        }
        await this.afterDate(user, w, d);
        return true;
      }
      case "origin_text": {
        if (!/^[A-Za-z]{3}$/.test(text.trim())) {
          await this.h.channel.sendText(user.id, m.originBad);
          return true;
        }
        const origin = text.trim().toUpperCase();
        this.h.store.setPref(user.id, "home_airport", origin);
        await this.search(user, { ...w, origin });
        return true;
      }
      default:
        return false;
    }
  }

  /** Botón o fila del menú. true si el identificador era del menú. */
  async onReply(user: User, replyId: string): Promise<boolean> {
    const [kind = "", arg = ""] = replyId.split(":");
    if (!MENU_KINDS.has(kind)) return false;
    const { store } = this.h;
    const m = this.t(user.lang);

    // Menú principal: vale siempre, esté o no en medio de un flujo.
    if (kind === "m") {
      if (arg === "new") await this.askType(user);
      else if (arg === "book") await this.showBookings(user);
      else if (arg === "prefs") await this.showPrefs(user);
      else if (arg === "contact") await this.contact(user);
      else await this.show(user);
      return true;
    }

    const w = store.getWizard<Wiz>(user.id);
    const stale = async () => {
      await this.h.channel.sendText(user.id, m.stale);
      await this.show(user);
      return true;
    };
    if (!w) return stale();

    switch (kind) {
      case "t": {
        if (w.step !== "type" || !["flight", "hotel", "full"].includes(arg)) return stale();
        await this.askDest(user, { ...w, type: arg as Wiz["type"] });
        return true;
      }
      case "c": {
        if (w.step !== "dest") return stale();
        if (arg === "other") {
          store.setWizard(user.id, { ...w, step: "dest_text" });
          await this.h.channel.sendText(user.id, m.destAsk);
          return true;
        }
        const city = w.dests?.[Number(arg)];
        if (!city) return stale();
        const iata = iataFor(city);
        if (!iata) {
          // Ciudad de un viaje anterior que no conozco: se pide el código del aeropuerto.
          store.setWizard(user.id, { ...w, step: "dest_text" });
          await this.h.channel.sendText(user.id, m.destAsk);
          return true;
        }
        await this.afterDest(user, w, city, iata);
        return true;
      }
      case "n": {
        if (w.step !== "nights") return stale();
        if (arg === "other") {
          store.setWizard(user.id, { ...w, step: "nights_text" });
          await this.h.channel.sendText(user.id, m.nightsAsk);
          return true;
        }
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1) return stale();
        await this.afterNights(user, w, n);
        return true;
      }
      case "d": {
        if (w.step !== "date") return stale();
        if (arg === "other") {
          store.setWizard(user.id, { ...w, step: "date_text" });
          await this.h.channel.sendText(user.id, m.dateAsk);
          return true;
        }
        if (!parseDate(arg, this.today())) return stale();
        await this.afterDate(user, w, arg);
        return true;
      }
      case "o": {
        if (w.step !== "pick_flight" && w.step !== "pick_hotel" && w.step !== "pick_return") return stale();
        const opt = w.options?.[Number(arg)];
        if (!opt) return stale();
        await this.pick(user, w, opt);
        return true;
      }
      case "r": {
        if (w.step !== "return_ask") return stale();
        if (arg === "yes") await this.searchReturn(user, w);
        else await this.finish(user, w);
        return true;
      }
    }
    return stale();
  }

  // ---- pasos ----

  private async askType(user: User) {
    const m = this.t(user.lang);
    this.h.store.setWizard(user.id, { step: "type" } satisfies Wiz);
    await this.h.channel.sendButtons(user.id, m.whatNeed, [
      { id: "t:flight", title: m.typeFlight },
      { id: "t:hotel", title: m.typeHotel },
      { id: "t:full", title: m.typeFull },
    ]);
  }

  private async askDest(user: User, w: Wiz) {
    const m = this.t(user.lang);
    const dests = [...this.h.store.recentCities(user.id)];
    for (const d of DEFAULT_DESTS) if (dests.length < 4 && !dests.includes(d)) dests.push(d);
    this.h.store.setWizard(user.id, { ...w, step: "dest", dests });
    await this.h.channel.sendList(user.id, m.whereTo, m.destLabel, [...dests.map((d, i) => ({ id: `c:${i}`, title: d })), { id: "c:other", title: m.destOther }]);
  }

  private async afterDest(user: User, w: Wiz, city: string, iata: string) {
    const next: Wiz = { ...w, destCity: city, destIata: iata };
    if (w.type === "flight") return this.askDate(user, next);
    return this.askNights(user, next);
  }

  private async askNights(user: User, w: Wiz) {
    const m = this.t(user.lang);
    this.h.store.setWizard(user.id, { ...w, step: "nights" });
    await this.h.channel.sendButtons(user.id, m.nights, [
      { id: "n:2", title: "2" },
      { id: "n:3", title: "3" },
      { id: "n:other", title: m.nightsOther },
    ]);
  }

  private async afterNights(user: User, w: Wiz, nights: number) {
    await this.askDate(user, { ...w, nights });
  }

  private async askDate(user: User, w: Wiz) {
    const m = this.t(user.lang);
    const today = this.today();
    const rows = Array.from({ length: 5 }, (_, i) => {
      const iso = addDays(today, i + 1);
      return { id: `d:${iso}`, title: this.fmtDate(iso, user.lang) };
    });
    this.h.store.setWizard(user.id, { ...w, step: "date" });
    await this.h.channel.sendList(user.id, m.date, m.dateLabel, [...rows, { id: "d:other", title: m.dateOther }]);
  }

  private async afterDate(user: User, w: Wiz, date: string) {
    const next: Wiz = { ...w, date };
    if (w.type === "hotel") return this.search(user, next);
    const home = this.h.store.getPrefs(user.id).home_airport;
    if (typeof home === "string" && /^[A-Za-z]{3}$/.test(home)) return this.search(user, { ...next, origin: home.toUpperCase() });
    this.h.store.setWizard(user.id, { ...next, step: "origin_text" });
    await this.h.channel.sendText(user.id, this.t(user.lang).originAsk);
  }

  /** Busca lo que toque según el tipo de viaje: vuelo de ida o, si es solo hotel, hoteles. */
  private async search(user: User, w: Wiz) {
    if (w.type === "hotel") return this.searchHotels(user, w);
    return this.searchFlights(user, w, w.origin!, w.destIata!, w.date!, "pick_flight");
  }

  private async searchFlights(user: User, w: Wiz, from: string, to: string, date: string, step: "pick_flight" | "pick_return") {
    const m = this.t(user.lang);
    const prefs = this.h.store.getPrefs(user.id);
    const lower = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
    const avoid = lower(prefs.avoid_airlines);
    const preferred = lower(prefs.preferred_airlines);

    let flights: FlightOption[] = await this.h.providers.searchFlights({ from, to, date });
    flights = flights.filter((f) => !avoid.includes(f.airline.toLowerCase()) && (prefs.direct_only !== true || f.stops === 0));
    flights.sort((a, b) => Number(preferred.includes(b.airline.toLowerCase())) - Number(preferred.includes(a.airline.toLowerCase())) || a.priceEur - b.priceEur);
    flights = flights.slice(0, 3);

    if (flights.length === 0) {
      await this.h.channel.sendText(user.id, m.noFlights);
      // Para la ida se vuelve a pedir la fecha; para la vuelta se da por terminado.
      return step === "pick_flight" ? this.askDate(user, w) : this.finish(user, w);
    }

    const options: Opt[] = flights.map((f) => ({
      kind: "flight",
      title: m.flightTitle(f.from, f.to, this.fmtDate(f.departure.slice(0, 10), user.lang), f.airline),
      details: `${f.departure.slice(11, 16)} - ${f.arrival.slice(11, 16)} · ${f.stops === 0 ? m.direct : m.stops(f.stops)}${f.refundable ? ` · ${m.refundable}` : ""}`,
      amountEur: f.priceEur,
      attrs: {
        airline: f.airline,
        stops: f.stops,
        refundable: f.refundable,
        city: cityFor(f.to),
        starts_at: `${f.departure}:00${offsetFor(f.from)}`,
      },
    }));
    this.h.store.setWizard(user.id, { ...w, step, options });
    await this.h.channel.sendList(
      user.id,
      step === "pick_flight" ? m.flights(from, to, this.fmtDate(date, user.lang)) : m.returnFlights(from, to, this.fmtDate(date, user.lang)),
      m.choose,
      flights.map((f, i) => ({
        id: `o:${i}`,
        title: `${f.airline} ${f.departure.slice(11, 16)}`.slice(0, 24),
        description: `${this.money(f.priceEur)} · ${f.stops === 0 ? m.direct : m.stops(f.stops)}${f.refundable ? ` · ${m.refundable}` : ""}${i === 0 ? ` · ${m.recommended}` : ""}`,
      })),
    );
  }

  private async searchHotels(user: User, w: Wiz) {
    const m = this.t(user.lang);
    const prefs = this.h.store.getPrefs(user.id);
    const nights = w.nights ?? 1;
    const checkOut = addDays(w.date!, nights);
    let hotels: HotelOption[] = await this.h.providers.searchHotels({
      city: w.destCity!,
      checkIn: w.date!,
      checkOut,
      minStars: typeof prefs.hotel_min_stars === "number" ? prefs.hotel_min_stars : undefined,
      onlineCheckinOnly: prefs.require_online_checkin === true,
    });
    // Los que tienen check-in online y llave digital, primero: el cliente quiere evitar la recepción.
    hotels = [...hotels].sort((a, b) => Number(b.onlineCheckin) + Number(b.digitalKey) - (Number(a.onlineCheckin) + Number(a.digitalKey)) || a.pricePerNightEur - b.pricePerNightEur).slice(0, 3);

    if (hotels.length === 0) {
      await this.h.channel.sendText(user.id, m.noHotels);
      return this.finish(user, w);
    }

    const offset = offsetFor(iataFor(w.destCity!) ?? "");
    const options: Opt[] = hotels.map((h) => ({
      kind: "hotel",
      title: h.name,
      details: m.hotelDetails(nights, this.fmtDate(w.date!, user.lang), h.stars),
      amountEur: h.pricePerNightEur * nights,
      attrs: {
        stars: h.stars,
        city: w.destCity!,
        online_checkin: h.onlineCheckin,
        digital_key: h.digitalKey,
        starts_at: `${w.date}T15:00:00${offset}`,
        ends_at: `${checkOut}T11:00:00${offset}`,
      },
    }));
    this.h.store.setWizard(user.id, { ...w, step: "pick_hotel", options });
    await this.h.channel.sendList(
      user.id,
      m.hotels(w.destCity!, nights),
      m.choose,
      hotels.map((h, i) => ({
        id: `o:${i}`,
        title: h.name.slice(0, 24),
        description: [`${this.money(h.pricePerNightEur)} ${m.perNight}`, m.stars(h.stars), h.onlineCheckin ? m.onlineCheckin : "", h.digitalKey ? m.digitalKey : ""].filter(Boolean).join(" · "),
      })),
    );
  }

  /** El cliente ha elegido una opción: se crea la propuesta y se pide su aprobación. */
  private async pick(user: User, w: Wiz, opt: Opt) {
    const { store } = this.h;
    const m = this.t(user.lang);
    const plan = (w.planId ? store.getPlan(w.planId) : undefined) ?? store.openPlan(user.id) ?? store.createPlan(user.id, `${w.destCity ?? ""} ${w.date ?? ""}`.trim() || opt.title);
    const proposal = store.createProposal({
      planId: plan.id,
      userId: user.id,
      kind: opt.kind,
      title: opt.title,
      details: opt.details,
      amountEur: opt.amountEur,
      attrs: opt.attrs,
    });
    const next: Wiz = { ...w, planId: plan.id, options: undefined };
    await this.h.sendApproval(user, proposal.id);

    if (w.step === "pick_flight") {
      if (w.type === "full") return this.searchHotels(user, next);
      return this.finish(user, next);
    }
    if (w.step === "pick_hotel") {
      if (w.type === "full") {
        const back = addDays(w.date!, w.nights ?? 1);
        store.setWizard(user.id, { ...next, step: "return_ask" });
        return this.h.channel.sendButtons(user.id, m.returnAsk(this.fmtDate(back, user.lang)), [
          { id: "r:yes", title: m.yes },
          { id: "r:no", title: m.no },
        ]);
      }
      return this.finish(user, next);
    }
    return this.finish(user, next);
  }

  private async searchReturn(user: User, w: Wiz) {
    const back = addDays(w.date!, w.nights ?? 1);
    await this.searchFlights(user, w, w.destIata!, w.origin ?? "", back, "pick_return");
  }

  /** Fin del flujo: el plan queda cerrado y, cuando se decida todo, se pedirá la valoración. */
  private async finish(user: User, w: Wiz) {
    const { store } = this.h;
    store.clearWizard(user.id);
    await this.h.channel.sendText(user.id, this.t(user.lang).done);
    const plan = w.planId ? store.getPlan(w.planId) : undefined;
    if (plan && plan.status === "open") {
      store.setPlanStatus(plan.id, "closing");
      await this.h.askRating(user, plan.id);
    }
  }

  // ---- el resto del menú ----

  private async showBookings(user: User) {
    this.h.store.clearWizard(user.id);
    const m = this.t(user.lang);
    const list = this.h.store.listProposals(user.id);
    if (list.length === 0) return this.h.channel.sendText(user.id, m.bookingsNone);
    const lines = list.map((p) => `• ${p.title} · ${p.status === "pending" ? m.statusPending : p.confirmed ? m.statusConfirmed : m.statusApproved}`);
    await this.h.channel.sendText(user.id, `${m.bookingsTitle}\n${lines.join("\n")}`);
  }

  private async showPrefs(user: User) {
    this.h.store.clearWizard(user.id);
    const m = this.t(user.lang);
    const prefs = this.h.store.getPrefs(user.id);
    const lines = Object.entries(prefs).map(([k, v]) => {
      const value = v === true ? m.yesWord : Array.isArray(v) ? v.join(", ") : String(v);
      return `• ${m.prefLabels[k] ?? k}: ${value}`;
    });
    if (lines.length === 0) return this.h.channel.sendText(user.id, m.prefsNone);
    await this.h.channel.sendText(user.id, `${m.prefsTitle}\n${lines.join("\n")}\n\n${m.prefsFooter}`);
  }

  private async contact(user: User) {
    this.h.store.clearWizard(user.id);
    const incident = this.h.store.addIncident(user.id, "high", `${user.name ?? user.id} quiere hablar contigo.`);
    if (await this.h.alertOwner("high", `${user.name ?? user.id} pide que le escribas por el chat.`)) this.h.store.markIncidentNotified(incident.id);
    await this.h.channel.sendText(user.id, this.t(user.lang).contactDone(this.h.ownerName));
  }
}
