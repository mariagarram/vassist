import { parseTripDates } from "./dates";
import { T } from "./i18n";
import { cityFor, iataFor, offsetFor, type FlightOption, type HotelOption, type TravelProvider } from "./providers";
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
  providers: TravelProvider;
  /** Aprueba la propuesta como si el cliente hubiera pulsado «Aprobar»: avisa a María, que reserva y confirma. */
  approve(user: User, proposalId: string): Promise<void>;
  /** Vuelve al menú principal. */
  menu(user: User): Promise<void>;
}

type L2 = { en: string; ar: string; es?: string };
type Opt = { v: string } & L2;
type Ctx = { user: User; prefs: Record<string, unknown>; recent: string[]; today: string };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Q = {
  key: string;
  /** Etiqueta del campo en el resumen. */
  name: L2;
  ask: L2;
  opts: (c: Ctx) => Opt[];
  /** Fila «otro»: abre una pregunta de texto. */
  other?: { label: L2; ask: L2; placeholder: L2 };
  multi?: boolean;
  /** Pregunta básica: sin ella no se puede buscar. El resto son preferencias opcionales. */
  core?: boolean;
  /** La fila «otro» va la primera (cuando lo habitual es escribir). */
  otherFirst?: boolean;
};

const o = (v: string, en: string, ar: string): Opt => ({ v, en, ar });

const ES: Record<string, string> = {
  "Destination": "Destino", "Where would you like to go?": "¿A dónde le gustaría ir?", "Another place": "Otro lugar",
  "Please write the place: any city, town, region or country.": "Escriba el lugar: cualquier ciudad, pueblo, región o país.",
  "City, town, region or country": "Ciudad, pueblo, región o país",
  "Departing from": "Salida desde", "Where will you travel from?": "¿Desde dónde viajará?",
  "Please write the city or airport you will depart from.": "Escriba la ciudad o el aeropuerto de salida.", "City or airport": "Ciudad o aeropuerto",
  "Purpose": "Motivo", "What is the purpose of the trip?": "¿Cuál es el motivo del viaje?", "Business": "Trabajo", "Medical": "Salud", "Leisure": "Ocio", "Family": "Familiar", "Event or conference": "Evento o congreso",
  "When": "Cuándo", "When would you like to travel?": "¿Cuándo le gustaría viajar?", "In 3 days": "En 3 días", "In 1 week": "En 1 semana", "In 2 weeks": "En 2 semanas", "In 1 month": "En 1 mes", "In 2 to 3 months": "En 2 o 3 meses",
  "Exact dates": "Fechas exactas", "Please write your dates, for example 12 to 15 November, or 2026-11-12 to 2026-11-15. One date is fine too.": "Escriba sus fechas, por ejemplo «del 12 al 15 de noviembre» o 2026-11-12 al 2026-11-15. Con una sola fecha también vale.", "12 to 15 November": "Del 12 al 15 de noviembre",
  "Nights": "Noches", "How many nights will you stay?": "¿Cuántas noches se alojará?", "2 nights": "2 noches", "4 nights": "4 noches", "1 week": "1 semana", "10 nights": "10 noches", "2 weeks": "2 semanas",
  "Other number": "Otro número", "Please write the number of nights, for example 5.": "Escriba el número de noches, por ejemplo 5.", "Number of nights": "Número de noches",
  "Travellers": "Viajeros", "Who is travelling?": "¿Quién viaja?", "Just me": "Solo yo", "2 adults": "2 adultos", "Family with children": "Familia con niños", "Group of 3 to 5": "Grupo de 3 a 5", "Group of 6 or more": "Grupo de 6 o más",
  "Budget": "Presupuesto", "What budget level do you have in mind?": "¿Qué nivel de presupuesto tiene en mente?", "Economy": "Económico", "Comfortable": "Cómodo", "Premium": "Premium", "Luxury": "Lujo", "No limit": "Sin límite",
  "Set an amount": "Indicar una cifra", "Please write your total budget with the currency, for example 3000 EUR.": "Escriba su presupuesto total con la moneda, por ejemplo 3000 EUR.", "For example 3000 EUR": "Por ejemplo 3000 EUR",
  "Getting there": "Medio de transporte", "How would you like to travel?": "¿Cómo le gustaría viajar?", "Plane": "Avión", "Train": "Tren", "Car, I drive": "Coche, conduzco yo", "Car with driver": "Coche con chófer", "Bus or ferry": "Autobús o ferri", "Recommend me": "Recomiéndeme",
  "Accommodation": "Alojamiento", "What kind of accommodation?": "¿Qué tipo de alojamiento prefiere?", "Hotel 3 stars": "Hotel 3 estrellas", "Hotel 4 stars": "Hotel 4 estrellas", "Hotel 5 stars": "Hotel 5 estrellas", "Boutique hotel": "Hotel boutique", "Apartment": "Apartamento", "Not needed": "No lo necesito",
  "Food": "Comida", "Any dietary requirements?": "¿Tiene requisitos alimentarios?", "No restrictions": "Sin restricciones", "Halal": "Halal", "Vegetarian": "Vegetariano", "Vegan": "Vegano", "Other": "Otro",
  "Please write your dietary requirements.": "Escriba sus requisitos alimentarios.", "Your dietary requirements": "Sus requisitos alimentarios",
  "Interests": "Intereses", "What do you enjoy? Choose up to 3, then press Done.": "¿Qué le gusta? Elija hasta 3 y pulse Hecho.", "Culture and history": "Cultura e historia", "Nature and outdoors": "Naturaleza y aire libre", "Shopping": "Compras", "Wellness and spa": "Bienestar y spa", "Gastronomy": "Gastronomía", "Family activities": "Actividades en familia", "Nightlife": "Vida nocturna",
  "Pace": "Ritmo", "How full should the days be?": "¿Cómo de llenos quiere los días?", "Relaxed": "Tranquilo", "Balanced": "Equilibrado", "Packed": "Intenso",
  "Notes": "Notas", "Anything else I should know?": "¿Algo más que deba saber?", "No, that is all": "No, eso es todo", "Add a note": "Añadir una nota", "Please write your note.": "Escriba su nota.", "Your note": "Su nota",
};
/** Texto de una pregunta u opción en el idioma del cliente. El español sale de ES por el texto en inglés. */
const tr = (x: L2, lang: Lang): string => (lang === "es" ? (x.es ?? ES[x.en] ?? x.en) : x[lang]);
/** Para las pruebas: textos en inglés sin traducción al español. */
export const untranslatedSpanish = (): string[] => {
  const all = QS.flatMap((q) => [q.name, q.ask, ...(q.other ? [q.other.label, q.other.ask, q.other.placeholder] : []), ...q.opts({ user: { lang: "en" } as User, prefs: {}, recent: [], today: "2026-10-04" })]);
  return [...new Set(all.map((x) => x.en))].filter((e) => !ES[e] && !/^\d{4}-\d{2}-\d{2}$/.test(e));
};

const QS: Q[] = [
  {
    key: "destination",
    core: true,
    name: { en: "Destination", ar: "الوجهة" },
    ask: { en: "Where would you like to go?", ar: "إلى أين تودون السفر؟" },
    opts: () => [],
    other: { label: { en: "Another place", ar: "وجهة أخرى" }, ask: { en: "Please write the place: any city, town, region or country.", ar: "اكتبوا اسم المكان: أي مدينة أو بلدة أو منطقة أو دولة." }, placeholder: { en: "City, town, region or country", ar: "مدينة أو بلدة أو منطقة أو دولة" } },
  },
  {
    key: "origin",
    core: true,
    name: { en: "Departing from", ar: "الانطلاق من" },
    ask: { en: "Where will you travel from?", ar: "من أين ستنطلقون؟" },
    opts: (c) => (typeof c.prefs.home_airport === "string" && c.prefs.home_airport ? [{ ...o(c.prefs.home_airport, `From ${c.prefs.home_airport}`, `من ${c.prefs.home_airport}`), es: `Desde ${c.prefs.home_airport}` }] : []),
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
    core: true,
    name: { en: "When", ar: "الموعد" },
    ask: { en: "When would you like to travel?", ar: "متى تودون السفر؟" },
    opts: (c) => [
      o(addDays(c.today, 3), "In 3 days", "بعد 3 أيام"),
      o(addDays(c.today, 7), "In 1 week", "بعد أسبوع"),
      o(addDays(c.today, 14), "In 2 weeks", "بعد أسبوعين"),
      o(addDays(c.today, 30), "In 1 month", "بعد شهر"),
      o(addDays(c.today, 75), "In 2 to 3 months", "بعد شهرين إلى ثلاثة"),
    ],
    otherFirst: true,
    other: { label: { en: "Exact dates", ar: "تواريخ محددة" }, ask: { en: "Please write your dates, for example 12 to 15 November, or 2026-11-12 to 2026-11-15. One date is fine too.", ar: "اكتبوا تواريخكم، مثل 12 إلى 15 نوفمبر، أو 2026-11-12 إلى 2026-11-15. يكفي أيضاً تاريخ واحد." }, placeholder: { en: "12 to 15 November", ar: "12 إلى 15 نوفمبر" } },
  },
  {
    key: "length",
    core: true,
    name: { en: "Nights", ar: "عدد الليالي" },
    ask: { en: "How many nights will you stay?", ar: "كم ليلة ستقيمون؟" },
    opts: () => [
      o("2", "2 nights", "ليلتان"),
      o("4", "4 nights", "4 ليال"),
      o("7", "1 week", "أسبوع"),
      o("10", "10 nights", "10 ليال"),
      o("14", "2 weeks", "أسبوعان"),
    ],
    other: { label: { en: "Other number", ar: "عدد آخر" }, ask: { en: "Please write the number of nights, for example 5.", ar: "اكتبوا عدد الليالي، مثل 5." }, placeholder: { en: "Number of nights", ar: "عدد الليالي" } },
  },
  {
    key: "travellers",
    core: true,
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
      o("boutique hotel", "Boutique hotel", "فندق بوتيك"),
      o("apartment", "Apartment", "شقة"),
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
    stays: "Hotels and apartments",
    back: "Back to the list",
    book: "Book",
    staysHead: (city: string, n: number, from: string) => `Stays in ${city}, ${n} night${n === 1 ? "" : "s"} from ${from}. Tap one to see it:`,
    staysNone: "I found no stays for those dates. You can adjust the plan and try again.",
    staysGone: "Those results are no longer available. Please press Hotels and apartments again.",
    hotel: "Hotel",
    apartment: "Apartment",
    perNight: "per night",
    freeCancel: "free cancellation",
    onlineCheckin: "online check-in",
    digitalKey: "digital key",
    km: "km from the centre",
    total: (n: number, eur: number) => `${n} night${n === 1 ? "" : "s"}: EUR ${eur}`,
    hubHead: "Your trip",
    hubAsk: "What would you like to do?",
    rowFlights: "Flights",
    rowStays: "Hotels and apartments",
    rowFull: "Full plan with itinerary",
    rowPrefs: "My travel preferences",
    rowChange: "Change trip details",
    rowReturn: "Return flight",
    rowMenu: "Back to the menu",
    rowMore: (n: number) => `More results (${n})`,
    rowBackTrip: "Back to my trip",
    changeAsk: "What would you like to change?",
    badDate: "I could not read that date. Try for example 12 to 15 November, or 2026-11-12, and a day in the future.",
    badNights: "Please write a number of nights between 1 and 60.",
    usual: (from: string, who: string) => `I am using your usual details: from ${from}, ${who}. You can change them at any time.`,
    prefsStart: "A few optional questions so I can tailor your trips. I will remember your answers.",
    flHead: (f: string, t: string, d: string) => `Flights from ${f} to ${t} on ${d}:`,
    flHeadRet: (f: string, t: string, d: string) => `Return flights from ${f} to ${t} on ${d}:`,
    flNone: "I found no flights for that day.",
    flNoAirport: (place: string) => `I could not match an airport for ${place}. Please change the place to a city with an airport, or ask me for a train or car plan.`,
    showing: (a: number, b: number, n: number) => `Showing ${a} to ${b} of ${n}, cheapest first.`,
    direct: "direct",
    stops: (n: number) => `${n} stop${n === 1 ? "" : "s"}`,
    refundable: "refundable",
    sampleFlight: "Sample data: schedules and prices are for testing until a live provider is connected.",
    sample: "Sample data: price, photo and map pin are for testing until a live provider is connected.",
  },
  es: {
    start: "Planifiquemos su viaje. Le haré unas preguntas; solo tiene que pulsar sus respuestas.",
    other: "Otro",
    done: "Hecho",
    skip: "Omitir el resto",
    pick: "Elegir",
    summary: "Este es el resumen de su viaje:",
    go: "Crear mi plan",
    redo: "Empezar de nuevo",
    cancel: "Cancelar",
    stale: "Esa opción ya no está activa. Continúe más abajo, por favor.",
    working: "Gracias. Estoy preparando su plan, un momento por favor.",
    make: "Crear propuestas",
    adjust: "Ajustar el plan",
    afterPlan: "¿Qué quiere hacer con este plan?",
    adjustAsk: "Por supuesto. Dígame con sus palabras qué quiere cambiar.",
    makeText: "Sí, por favor, crea las propuestas para este plan.",
    notSet: "Sin especificar",
    cancelled: "Planificador cancelado. Escriba \"menú\" cuando me necesite.",
    stays: "Hoteles y apartamentos",
    back: "Volver a la lista",
    book: "Reservar",
    staysHead: (city: string, n: number, from: string) => `Alojamientos en ${city}, ${n} noche${n === 1 ? "" : "s"} desde el ${from}. Pulse uno para verlo:`,
    staysNone: "No he encontrado alojamientos para esas fechas. Puede ajustar el plan e intentarlo de nuevo.",
    staysGone: "Esos resultados ya no están disponibles. Pulse de nuevo Hoteles y apartamentos.",
    hotel: "Hotel",
    apartment: "Apartamento",
    perNight: "por noche",
    freeCancel: "cancelación gratuita",
    onlineCheckin: "check-in online",
    digitalKey: "llave digital",
    km: "km del centro",
    total: (n: number, eur: number) => `${n} noche${n === 1 ? "" : "s"}: EUR ${eur}`,
    hubHead: "Su viaje",
    hubAsk: "¿Qué quiere hacer?",
    rowFlights: "Vuelos",
    rowStays: "Hoteles y apartamentos",
    rowFull: "Plan completo con itinerario",
    rowPrefs: "Mis preferencias de viaje",
    rowChange: "Cambiar datos del viaje",
    rowReturn: "Vuelo de vuelta",
    rowMenu: "Volver al menú",
    rowMore: (n: number) => `Más resultados (${n})`,
    rowBackTrip: "Volver a mi viaje",
    changeAsk: "¿Qué quiere cambiar?",
    badDate: "No he podido leer esa fecha. Pruebe por ejemplo «del 12 al 15 de noviembre» o 2026-11-12, y un día futuro.",
    badNights: "Escriba un número de noches entre 1 y 60.",
    usual: (from: string, who: string) => `Uso sus datos habituales: salida desde ${from}, ${who}. Puede cambiarlos cuando quiera.`,
    prefsStart: "Unas preguntas opcionales para ajustar sus viajes. Recordaré sus respuestas.",
    flHead: (f: string, t: string, d: string) => `Vuelos de ${f} a ${t} el ${d}:`,
    flHeadRet: (f: string, t: string, d: string) => `Vuelos de vuelta de ${f} a ${t} el ${d}:`,
    flNone: "No he encontrado vuelos para ese día.",
    flNoAirport: (place: string) => `No he podido encontrar un aeropuerto para ${place}. Cambie el lugar por una ciudad con aeropuerto, o pídame un plan en tren o en coche.`,
    showing: (a: number, b: number, n: number) => `Mostrando del ${a} al ${b} de ${n}, del más barato al más caro.`,
    direct: "directo",
    stops: (n: number) => `${n} escala${n === 1 ? "" : "s"}`,
    refundable: "reembolsable",
    sampleFlight: "Datos de muestra: los horarios y precios son de prueba hasta conectar un proveedor real.",
    sample: "Datos de muestra: el precio, la foto y el pin del mapa son de prueba hasta conectar un proveedor real.",
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
    stays: "فنادق وشقق",
    back: "العودة إلى القائمة",
    book: "احجز",
    staysHead: (city: string, n: number, from: string) => `أماكن الإقامة في ${city}، ${n} ليلة ابتداءً من ${from}. اضغطوا على أحدها لعرضه:`,
    staysNone: "لم أجد إقامة في هذه التواريخ. يمكنكم تعديل الخطة والمحاولة مجدداً.",
    staysGone: "هذه النتائج لم تعد متاحة. اضغطوا على فنادق وشقق مرة أخرى من فضلكم.",
    hotel: "فندق",
    apartment: "شقة",
    perNight: "لليلة",
    freeCancel: "إلغاء مجاني",
    onlineCheckin: "تسجيل وصول عبر الإنترنت",
    digitalKey: "مفتاح رقمي",
    km: "كم عن المركز",
    total: (n: number, eur: number) => `${n} ليلة: ${eur} يورو`,
    hubHead: "رحلتكم",
    hubAsk: "ماذا تودون أن تفعلوا؟",
    rowFlights: "رحلات طيران",
    rowStays: "فنادق وشقق",
    rowFull: "خطة كاملة مع البرنامج",
    rowPrefs: "تفضيلات السفر",
    rowChange: "تغيير بيانات الرحلة",
    rowReturn: "رحلة العودة",
    rowMenu: "العودة إلى القائمة",
    rowMore: (n: number) => `المزيد من النتائج (${n})`,
    rowBackTrip: "العودة إلى رحلتي",
    changeAsk: "ماذا تودون أن تغيّروا؟",
    badDate: "لم أتمكن من قراءة هذا التاريخ. جرّبوا مثلاً 12 إلى 15 نوفمبر أو 2026-11-12، ويوماً في المستقبل.",
    badNights: "اكتبوا عدد ليالٍ بين 1 و60.",
    usual: (from: string, who: string) => `أستخدم بياناتكم المعتادة: الانطلاق من ${from}، ${who}. يمكنكم تغييرها في أي وقت.`,
    prefsStart: "بعض الأسئلة الاختيارية لأخصّص رحلاتكم. سأتذكر إجاباتكم.",
    flHead: (f: string, t: string, d: string) => `رحلات من ${f} إلى ${t} بتاريخ ${d}:`,
    flHeadRet: (f: string, t: string, d: string) => `رحلات العودة من ${f} إلى ${t} بتاريخ ${d}:`,
    flNone: "لم أجد رحلات لهذا اليوم.",
    flNoAirport: (place: string) => `لم أتمكن من إيجاد مطار لـ ${place}. غيّروا المكان إلى مدينة فيها مطار، أو اطلبوا مني خطة بالقطار أو بالسيارة.`,
    showing: (a: number, b: number, n: number) => `عرض ${a} إلى ${b} من ${n}، الأرخص أولاً.`,
    direct: "مباشرة",
    stops: (n: number) => `${n} توقف`,
    refundable: "قابلة للاسترداد",
    sampleFlight: "بيانات تجريبية: المواعيد والأسعار للاختبار إلى أن يُربط مزوّد حقيقي.",
    sample: "بيانات تجريبية: السعر والصورة وموقع الخريطة للاختبار إلى أن يُربط مزوّد حقيقي.",
  },
};


const CORE = QS.filter((q) => q.core).map((q) => q.key);
const OPTIONAL = QS.filter((q) => !q.core).map((q) => q.key);
/** Respuestas que se recuerdan para el siguiente viaje. El destino, la fecha y las noches se preguntan siempre. */
const REMEMBER = ["origin", "travellers", "budget", "transport", "lodging", "food", "interests", "pace"];
const BY_KEY: Record<string, Q> = Object.fromEntries(QS.map((q) => [q.key, q]));
const PAGE = 8;

type State = { planner: true; seq: string[]; i: number; a: Record<string, string>; sel: string[]; awaiting?: boolean; opt?: boolean };
type Trip = { profile: Record<string, string>; cur?: Record<string, string> };
type Stay = HotelOption & { checkIn: string; checkOut: string; nights: number };
type FlightList = { dir: "out" | "ret"; from: string; to: string; date: string; items: FlightOption[] };
type View = { kind: "flight" | "stay"; page: number; flights?: FlightList; stays?: Stay[]; city?: string };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export class Planner {
  /** Última lista mostrada (vuelos o alojamientos) por cliente. Solo en memoria: si se reinicia, se pide repetir la búsqueda. */
  private views = new Map<string, View>();
  /** Qué tramos de vuelo ya se han reservado en este viaje. */
  private legs = new Map<string, { out?: boolean; ret?: boolean }>();

  constructor(private h: PlannerHost) {}

  private ctx(user: User): Ctx {
    return { user, prefs: this.h.store.getPrefs(user.id), recent: this.h.store.recentCities(user.id), today: this.today() };
  }
  private today() {
    return this.h.now().toISOString().slice(0, 10);
  }
  private trip(user: User): Trip {
    return this.h.store.getTrip<Trip>(user.id) ?? { profile: {} };
  }
  private state(user: User): State | null {
    const w = this.h.store.getWizard<Partial<State>>(user.id);
    return w?.planner ? (w as State) : null;
  }

  /** Empieza un viaje nuevo: solo pregunta lo básico que no se sabe ya. */
  async start(user: User) {
    const tx = TX[user.lang];
    const trip = this.trip(user);
    const a = { ...trip.profile };
    this.views.delete(user.id);
    this.legs.delete(user.id);
    const seq = CORE.filter((k) => !a[k]);
    this.h.store.setWizard(user.id, { planner: true, seq, i: 0, a, sel: [] } satisfies State);
    await this.h.channel.sendText(user.id, tx.start);
    if (a.origin && a.travellers) await this.h.channel.sendText(user.id, tx.usual(this.label(BY_KEY.origin!, a.origin, user.lang), this.label(BY_KEY.travellers!, a.travellers, user.lang)));
    await this.ask(user);
  }

  private async ask(user: User) {
    const w = this.state(user);
    if (!w) return;
    const key = w.seq[w.i];
    const q = key ? BY_KEY[key] : undefined;
    if (!q) return this.finishSeq(user, w);
    const tx = TX[user.lang];
    const lang = user.lang;
    const all = q.opts(this.ctx(user));
    // Sin opciones (p. ej. destino): se pregunta directamente por escrito.
    if (!all.length && q.other) {
      this.h.store.setWizard(user.id, { ...w, awaiting: true });
      await this.prompt(user, q);
      return;
    }
    const list: Row[] = all.flatMap((x, idx) => (w.sel.includes(x.v) ? [] : [{ id: `p:${w.i}:${idx}`, title: clip(tr(x, lang), 24) }]));
    if (q.multi) list.unshift({ id: `p:${w.i}:d`, title: `✓ ${tx.done}${w.sel.length ? ` (${w.sel.length})` : ""}` });
    if (q.other && list.length < 10) {
      const row = { id: `p:${w.i}:o`, title: clip(tr(q.other.label, lang), 24) };
      if (q.otherFirst) list.unshift(row);
      else list.push(row);
    }
    if (w.opt && list.length < 10) list.push({ id: `p:${w.i}:s`, title: tx.skip });
    await this.h.channel.sendList(user.id, `${w.i + 1}/${w.seq.length} · ${tr(q.ask, lang)}`, tx.pick, list);
  }

  /** Pregunta abierta: con recuadro de respuesta si el canal lo permite. */
  private async prompt(user: User, q: Q, text?: string) {
    const other = q.other;
    if (!other) return;
    const ask = text ?? tr(other.ask, user.lang);
    if (this.h.channel.sendPrompt) await this.h.channel.sendPrompt(user.id, ask, tr(other.placeholder, user.lang));
    else await this.h.channel.sendText(user.id, ask);
  }

  private label(q: Q, value: string, lang: Lang): string {
    const found = q.opts({ user: { lang } as User, prefs: {}, recent: [], today: this.today() }).find((x) => x.v === value);
    return found ? tr(found, lang) : value;
  }

  /** Terminadas las preguntas: se guardan las respuestas que se recuerdan y se muestra el panel del viaje. */
  private async finishSeq(user: User, w: State) {
    const trip = this.trip(user);
    const profile = { ...trip.profile };
    for (const k of REMEMBER) if (w.a[k]) profile[k] = w.a[k]!;
    this.h.store.clearWizard(user.id);
    const before = trip.cur ?? {};
    // Si cambia el destino, la fecha o las noches, las listas anteriores ya no valen.
    if (["destination", "when", "length", "origin"].some((k) => before[k] !== w.a[k])) this.views.delete(user.id);
    this.h.store.setTrip(user.id, { profile, cur: w.a } satisfies Trip);
    await this.hub(user);
  }

  /** Panel del viaje: los datos y lo que se puede hacer ahora. */
  async hub(user: User) {
    const trip = this.trip(user);
    const a = trip.cur;
    if (!a?.destination) return this.start(user);
    const tx = TX[user.lang];
    const lines = CORE.map((k) => {
      const q = BY_KEY[k]!;
      return `• ${tr(q.name, user.lang)}: ${a[k] ? this.label(q, a[k]!, user.lang) : tx.notSet}`;
    });
    const legs = this.legs.get(user.id) ?? {};
    const rows: Row[] = [
      { id: "p:fl", title: tx.rowFlights },
      ...(legs.out && !legs.ret ? [{ id: "p:rt", title: tx.rowReturn }] : []),
      { id: "p:st", title: tx.stays },
      { id: "p:go", title: tx.rowFull },
      { id: "p:pf", title: tx.rowPrefs },
      { id: "p:ch", title: tx.rowChange },
      { id: "p:menu", title: tx.rowMenu },
    ];
    await this.h.channel.sendList(user.id, `${tx.hubHead}\n\n${lines.join("\n")}\n\n${tx.hubAsk}`, tx.pick, rows);
  }

  /** Texto escrito mientras el planificador espera una respuesta abierta. false: no era para el planificador. */
  async onText(user: User, text: string): Promise<boolean> {
    const w = this.state(user);
    if (!w) return false;
    if (!w.awaiting) {
      // Texto libre en mitad del formulario: se abandona y lo atiende la IA.
      this.h.store.clearWizard(user.id);
      return false;
    }
    const q = BY_KEY[w.seq[w.i] ?? ""];
    if (!q) return false;
    const tx = TX[user.lang];
    let value = clip(text.trim(), 200);
    if (q.key === "when") {
      const dates = parseTripDates(value, this.today());
      if (!dates) {
        await this.prompt(user, q, tx.badDate);
        return true;
      }
      // Con fechas de salida y vuelta ya se sabe cuántas noches: no se vuelve a preguntar.
      const a = dates.nights ? { ...w.a, when: dates.from, length: String(dates.nights) } : { ...w.a, when: dates.from };
      const skipLength = dates.nights !== undefined && w.seq[w.i + 1] === "length";
      this.h.store.setWizard(user.id, { ...w, a, i: w.i + (skipLength ? 2 : 1), sel: [], awaiting: false });
      await this.ask(user);
      return true;
    }
    if (q.key === "length") {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 60) {
        await this.prompt(user, q, tx.badNights);
        return true;
      }
      value = String(n);
    }
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
    const idx = Number(parts[2]);

    switch (arg) {
      case "make":
        await this.h.runText(user, tx.makeText);
        return true;
      case "adj":
        await channel.sendText(user.id, tx.adjustAsk);
        return true;
      case "hub":
        await this.hub(user);
        return true;
      case "menu":
        store.clearWizard(user.id);
        await this.h.menu(user);
        return true;
      case "cancel":
        store.clearWizard(user.id);
        await channel.sendText(user.id, tx.cancelled);
        return true;
      case "go":
        return this.fullPlan(user);
      case "pf": {
        const trip = this.trip(user);
        store.setWizard(user.id, { planner: true, seq: OPTIONAL, i: 0, a: { ...trip.profile, ...(trip.cur ?? {}) }, sel: [], opt: true } satisfies State);
        await channel.sendText(user.id, tx.prefsStart);
        await this.ask(user);
        return true;
      }
      case "ch": {
        const a = this.trip(user).cur ?? {};
        await channel.sendList(
          user.id,
          tx.changeAsk,
          tx.pick,
          CORE.map((k) => ({ id: `p:c:${k}`, title: clip(tr(BY_KEY[k]!.name, user.lang), 24), description: clip(a[k] ? this.label(BY_KEY[k]!, a[k]!, user.lang) : tx.notSet, 72) })),
        );
        return true;
      }
      case "c": {
        const key = parts[2] ?? "";
        if (!CORE.includes(key)) return this.stale(user);
        store.setWizard(user.id, { planner: true, seq: [key], i: 0, a: { ...(this.trip(user).cur ?? {}) }, sel: [] } satisfies State);
        await this.ask(user);
        return true;
      }
      case "fl":
        return this.showFlights(user, "out");
      case "rt":
        return this.showFlights(user, "ret");
      case "st":
        return this.showStays(user);
      case "mo": {
        const v = this.views.get(user.id);
        if (!v) return this.staleResults(user);
        v.page += 1;
        return v.kind === "flight" ? this.sendFlights(user) : this.sendStays(user);
      }
      case "bl": {
        const v = this.views.get(user.id);
        if (!v) return this.staleResults(user);
        return v.kind === "flight" ? this.sendFlights(user) : this.sendStays(user);
      }
      case "f":
        return this.showFlight(user, idx);
      case "fk":
        return this.bookFlight(user, idx);
      case "b":
        return this.showStay(user, idx);
      case "bk":
        return this.bookStay(user, idx);
    }

    const w = this.state(user);
    const i = Number(arg);
    const opt = parts[2] ?? "";
    if (!w || !Number.isInteger(i) || i !== w.i) return this.stale(user);
    const q = BY_KEY[w.seq[i] ?? ""];
    if (!q) return this.stale(user);

    if (opt === "s") return this.finishSeq(user, w), true;
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
    await this.h.channel.sendText(user.id, TX[user.lang].stale);
    if (this.state(user)) await this.ask(user);
    else await this.hub(user);
    return true;
  }

  private async staleResults(user: User) {
    await this.h.channel.sendText(user.id, TX[user.lang].staysGone);
    await this.hub(user);
    return true;
  }

  private nights(a: Record<string, string>) {
    const n = Number.parseInt(a.length ?? "", 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

  // ---- vuelos ----
  private async showFlights(user: User, dir: "out" | "ret") {
    const tx = TX[user.lang];
    const a = this.trip(user).cur;
    if (!a?.destination) return this.stale(user);
    const outPlace = dir === "out" ? a.origin : a.destination;
    const inPlace = dir === "out" ? a.destination : a.origin;
    const from = iataFor(outPlace ?? "");
    const to = iataFor(inPlace ?? "");
    if (!from || !to) {
      await this.h.channel.sendText(user.id, tx.flNoAirport(!from ? (outPlace ?? "?") : (inPlace ?? "?")));
      await this.hub(user);
      return true;
    }
    const date = dir === "out" ? a.when! : addDays(a.when!, this.nights(a));
    const prefs = this.h.store.getPrefs(user.id);
    const lower = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
    const preferred = lower(prefs.preferred_airlines);
    const avoid = lower(prefs.avoid_airlines);
    const rank = (f: FlightOption) => (preferred.includes(f.airline.toLowerCase()) ? 0 : avoid.includes(f.airline.toLowerCase()) ? 2 : 1);
    const found = await this.h.providers.searchFlights({ from, to, date });
    const items = [...found].sort((x, y) => rank(x) - rank(y) || x.priceEur - y.priceEur);
    if (!items.length) {
      await this.h.channel.sendText(user.id, tx.flNone);
      await this.hub(user);
      return true;
    }
    this.views.set(user.id, { kind: "flight", page: 0, flights: { dir, from, to, date, items } });
    return this.sendFlights(user);
  }

  private async sendFlights(user: User) {
    const tx = TX[user.lang];
    const v = this.views.get(user.id);
    const fl = v?.flights;
    if (!v || !fl) return this.staleResults(user);
    const start = v.page * PAGE;
    const slice = fl.items.slice(start, start + PAGE);
    const rows: Row[] = slice.map((f, i) => ({
      id: `p:f:${start + i}`,
      title: clip(`${f.airline} ${f.departure.slice(11, 16)}`, 24),
      description: `EUR ${f.priceEur} · ${f.stops === 0 ? tx.direct : tx.stops(f.stops)}${f.refundable ? ` · ${tx.refundable}` : ""}`,
    }));
    const left = fl.items.length - (start + slice.length);
    if (left > 0) rows.push({ id: "p:mo", title: tx.rowMore(left) });
    rows.push({ id: "p:hub", title: tx.rowBackTrip });
    const head = (fl.dir === "out" ? tx.flHead : tx.flHeadRet)(fl.from, fl.to, fl.date);
    await this.h.channel.sendList(user.id, `${head}\n${tx.showing(start + 1, start + slice.length, fl.items.length)}`, tx.pick, rows);
    return true;
  }

  private async showFlight(user: User, idx: number) {
    const tx = TX[user.lang];
    const fl = this.views.get(user.id)?.flights;
    const f = fl?.items[idx];
    if (!fl || !f) return this.staleResults(user);
    const body = [
      `${f.airline} · ${f.from} → ${f.to}`,
      `${f.departure.slice(0, 10)} · ${f.departure.slice(11, 16)} → ${f.arrival.slice(11, 16)}`,
      `EUR ${f.priceEur} · ${f.stops === 0 ? tx.direct : tx.stops(f.stops)}${f.refundable ? ` · ${tx.refundable}` : ""}`,
      tx.sampleFlight,
    ].join("\n");
    await this.h.channel.sendButtons(user.id, body, [
      { id: `p:fk:${idx}`, title: tx.book },
      { id: "p:bl", title: tx.back },
    ]);
    return true;
  }

  private async bookFlight(user: User, idx: number) {
    const { store } = this.h;
    const v = this.views.get(user.id);
    const fl = v?.flights;
    const f = fl?.items[idx];
    if (!v || !fl || !f) return this.staleResults(user);
    const plan = store.openPlan(user.id) ?? store.createPlan(user.id, `${cityFor(fl.to)} ${fl.date}`);
    const proposal = store.createProposal({
      planId: plan.id,
      userId: user.id,
      kind: "flight",
      title: T[user.lang].menu.flightTitle(f.from, f.to, fl.date, f.airline),
      details: `${f.departure.slice(11, 16)} - ${f.arrival.slice(11, 16)} · ${f.stops === 0 ? "direct" : `${f.stops} stop(s)`}${f.refundable ? " · refundable" : ""}`,
      amountEur: f.priceEur,
      attrs: { airline: f.airline, stops: f.stops, refundable: f.refundable, city: cityFor(f.to), starts_at: `${f.departure}:00${offsetFor(f.from)}` },
    });
    // Un segundo toque sobre «Reservar» no debe crear otra reserva.
    fl.items[idx] = undefined as unknown as FlightOption;
    const legs = this.legs.get(user.id) ?? {};
    legs[fl.dir] = true;
    this.legs.set(user.id, legs);
    await this.h.approve(user, proposal.id);
    await this.hub(user);
    return true;
  }

  // ---- hoteles y apartamentos ----
  private async showStays(user: User) {
    const tx = TX[user.lang];
    const a = this.trip(user).cur;
    if (!a?.destination) return this.stale(user);
    const lodging = a.lodging ?? "";
    const city = a.destination;
    const nights = this.nights(a);
    const checkIn = a.when!;
    const checkOut = addDays(checkIn, nights);
    const prefs = this.h.store.getPrefs(user.id);
    const stars = /(\d)-star/.exec(lodging);
    const found = await this.h.providers.searchHotels({
      city,
      checkIn,
      checkOut,
      minStars: stars ? Number(stars[1]) : 3,
      onlineCheckinOnly: prefs.require_online_checkin === true,
      includeApartments: true,
    });
    const apartmentsFirst = lodging === "apartment";
    const items = [...found]
      .sort((x, y) => Number(apartmentsFirst && y.type === "apartment") - Number(apartmentsFirst && x.type === "apartment") || x.pricePerNightEur - y.pricePerNightEur)
      .map((h) => ({ ...h, checkIn, checkOut, nights }));
    if (!items.length) {
      await this.h.channel.sendText(user.id, tx.staysNone);
      await this.hub(user);
      return true;
    }
    this.views.set(user.id, { kind: "stay", page: 0, stays: items, city });
    return this.sendStays(user);
  }

  private async sendStays(user: User) {
    const tx = TX[user.lang];
    const v = this.views.get(user.id);
    if (!v?.stays) return this.staleResults(user);
    const first = v.stays[0];
    const start = v.page * PAGE;
    const slice = v.stays.slice(start, start + PAGE);
    const rows: Row[] = slice.map((h, i) => ({
      id: `p:b:${start + i}`,
      title: clip(h.name, 24),
      description: `EUR ${h.pricePerNightEur} ${tx.perNight} · ${h.type === "apartment" ? tx.apartment : `${h.stars}★`}`,
    }));
    const left = v.stays.length - (start + slice.length);
    if (left > 0) rows.push({ id: "p:mo", title: tx.rowMore(left) });
    rows.push({ id: "p:hub", title: tx.rowBackTrip });
    const head = tx.staysHead(v.city ?? "", first?.nights ?? 1, first?.checkIn ?? "");
    await this.h.channel.sendList(user.id, `${head}\n${tx.showing(start + 1, start + slice.length, v.stays.length)}\n${tx.sample}`, tx.pick, rows);
    return true;
  }

  private async showStay(user: User, idx: number) {
    const tx = TX[user.lang];
    const h = this.views.get(user.id)?.stays?.[idx];
    if (!h) return this.staleResults(user);
    const total = h.pricePerNightEur * h.nights;
    const extras = [h.freeCancellation ? tx.freeCancel : "", h.onlineCheckin ? tx.onlineCheckin : "", h.digitalKey ? tx.digitalKey : ""].filter(Boolean).join(" · ");
    const body = [
      `${h.name} (${h.type === "apartment" ? tx.apartment : `${tx.hotel} ${h.stars}★`})`,
      `${h.checkIn} → ${h.checkOut}`,
      `EUR ${h.pricePerNightEur} ${tx.perNight} · ${tx.total(h.nights, total)}`,
      `${h.distanceToCenterKm} ${tx.km}`,
      extras,
      tx.sample,
    ]
      .filter(Boolean)
      .join("\n");
    const buttons = [
      { id: `p:bk:${idx}`, title: tx.book },
      { id: "p:bl", title: tx.back },
    ];
    const ch = this.h.channel;
    // Tarjeta visual: pin del mapa y foto con los botones. Si el canal no los admite o fallan, texto y botones.
    if (ch.sendLocation && h.lat !== undefined && h.lon !== undefined) {
      await ch.sendLocation(user.id, h.lat, h.lon, h.name).catch(() => {});
    }
    if (ch.sendPhoto && h.imageUrl) {
      try {
        await ch.sendPhoto(user.id, h.imageUrl, body, buttons);
        return true;
      } catch {
        /* sigue con texto */
      }
    }
    await ch.sendButtons(user.id, body, buttons);
    return true;
  }

  /** «Reservar»: crea la propuesta y la aprueba. Después, reserva automática o aviso a María según el tipo (lo decide el flujo de aprobación). */
  private async bookStay(user: User, idx: number) {
    const { store } = this.h;
    const v = this.views.get(user.id);
    const h = v?.stays?.[idx];
    if (!v?.stays || !h) return this.staleResults(user);
    const offset = offsetFor(iataFor(h.city) ?? "");
    const plan = store.openPlan(user.id) ?? store.createPlan(user.id, `${h.city} ${h.checkIn}`);
    const proposal = store.createProposal({
      planId: plan.id,
      userId: user.id,
      kind: "hotel",
      title: h.name,
      details: `${h.type === "apartment" ? "Apartment" : `Hotel ${h.stars}*`}, ${h.nights} night(s), ${h.checkIn} to ${h.checkOut}`,
      amountEur: h.pricePerNightEur * h.nights,
      attrs: {
        stars: h.stars,
        city: h.city,
        online_checkin: h.onlineCheckin,
        digital_key: h.digitalKey,
        starts_at: `${h.checkIn}T15:00:00${offset}`,
        ends_at: `${h.checkOut}T11:00:00${offset}`,
        // Cancelación gratuita hasta dos días antes del check-in (dato de prueba; con proveedor real vendrá de él).
        ...(h.freeCancellation && addDays(h.checkIn, -2) > this.today() ? { cancel_by: `${addDays(h.checkIn, -2)}T18:00:00${offset}` } : {}),
      },
    });
    v.stays[idx] = undefined as unknown as Stay;
    await this.h.approve(user, proposal.id);
    await this.hub(user);
    return true;
  }

  // ---- plan completo con la IA ----
  private async fullPlan(user: User) {
    const tx = TX[user.lang];
    const a = this.trip(user).cur;
    if (!a?.destination) return this.stale(user);
    await this.h.channel.sendText(user.id, tx.working);
    await this.h.runBrief(user, this.brief(a, user.lang));
    return true;
  }

  /** Datos ya conocidos del viaje, para que la IA no vuelva a preguntarlos. Vacío si no hay viaje. */
  tripContext(userId: string): string {
    const trip = this.h.store.getTrip<Trip>(userId);
    const a = trip?.cur;
    if (!a?.destination) return "";
    const lines = QS.filter((q) => a[q.key]).map((q) => `- ${q.name.en}: ${a[q.key]}`);
    return `known_trip_details (already given by the client with the menu; never ask for them again, use them):\n${lines.join("\n")}`;
  }

  /** Formulario completo para la IA, en inglés (la IA responde en el idioma del cliente). */
  private brief(a: Record<string, string>, lang: Lang): string {
    const lines = QS.map((q) => `- ${q.name.en}: ${a[q.key] || "not specified"}`);
    return [
      `[Trip details given by the client with the menu. Reply language: ${lang}. Today is ${this.today()}. These details are final: do not ask for any of them again.]`,
      ...lines,
      "",
      "Please write the plan now: route and mode, a short day-by-day outline (morning, afternoon, evening) with restaurant and activity suggestions that fit the interests, pace and food needs, and an estimated cost breakdown against the budget level (mark every figure as an estimate). Do not search for or list specific flights, hotels or apartments, and do not give prices for them: the client uses the Flights and Hotels buttons for real bookable options, so only mention the best area to stay and the best way to travel. Keep it concise for a phone. Do not create proposals yet: the client will tap a button to confirm.",
    ].join("\n");
  }

  /** Botones tras el plan de la IA. */
  async afterPlan(user: User) {
    const tx = TX[user.lang];
    await this.h.channel.sendButtons(user.id, tx.afterPlan, [
      { id: "p:make", title: tx.make },
      { id: "p:adj", title: tx.adjust },
      { id: "p:hub", title: tx.rowBackTrip },
    ]);
  }
}
