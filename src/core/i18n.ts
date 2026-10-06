import type { Proposal, ReminderKind, Suggestion } from "./store";
import type { Lang } from "./types";

/**
 * Detecta el cambio de escritura. El inglés y el español comparten alfabeto, así que no se distinguen:
 * se respeta el que el cliente eligió con los botones. Con poco texto, mantiene el anterior.
 */
export function detectLang(text: string, fallback: Lang): Lang {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return fallback;
  const arabic = (letters.match(/[؀-ۿ]/g) ?? []).length;
  if (arabic / letters.length > 0.4) return "ar";
  return fallback === "ar" ? "en" : fallback;
}

export const LANG_PICK = "Choose your language · Elige tu idioma · اختر لغتك";
export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español", ar: "العربية" };

/** "2026-11-12T14:00:00+03:00" -> "2026-11-12 14:00" (hora local del destino tal como se guardó). */
const when = (v: unknown) => (typeof v === "string" ? v.slice(0, 16).replace("T", " ") : "");

const money = (n: number) => `EUR ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


type CardLabels = {
  confirmed: string;
  dates: string;
  total: string;
  reference: string;
  cancelUntil: (d: string) => string;
  noCancel: string;
  verified: string;
  unverified: string;
  remind: string;
  test: string;
};
const CARD: Record<Lang, CardLabels> = {
  en: {
    confirmed: "Booking confirmed",
    dates: "Dates",
    total: "Total",
    reference: "Reference",
    cancelUntil: (d) => `Free cancellation until ${d}`,
    noCancel: "No free cancellation listed: please check the conditions before any change",
    verified: "Checked against the provider's confirmation",
    unverified: "Not yet checked against the provider's confirmation",
    remind: "I will remind you before check-in and before any cancellation deadline.",
    test: "TEST MODE: simulated booking, nothing real was reserved or charged.",
  },
  es: {
    confirmed: "Reserva confirmada",
    dates: "Fechas",
    total: "Total",
    reference: "Referencia",
    cancelUntil: (d) => `Cancelación gratuita hasta el ${d}`,
    noCancel: "Sin cancelación gratuita indicada: revise las condiciones antes de cualquier cambio",
    verified: "Comprobada con la confirmación del proveedor",
    unverified: "Aún sin comprobar con la confirmación del proveedor",
    remind: "Le avisaré antes del check-in y antes de cualquier fecha límite de cancelación.",
    test: "MODO DE PRUEBA: reserva simulada, no se ha reservado ni cobrado nada real.",
  },
  ar: {
    confirmed: "تم تأكيد الحجز",
    dates: "التواريخ",
    total: "الإجمالي",
    reference: "المرجع",
    cancelUntil: (d) => `إلغاء مجاني حتى ${d}`,
    noCancel: "لا يوجد إلغاء مجاني: راجعوا الشروط قبل أي تغيير",
    verified: "تم التحقق من تأكيد المزوّد",
    unverified: "لم يتم التحقق بعد من تأكيد المزوّد",
    remind: "سأذكّركم قبل تسجيل الوصول وقبل أي موعد نهائي للإلغاء.",
    test: "وضع تجريبي: حجز محاكى، لم يُحجز أو يُخصم أي شيء فعلي.",
  },
};

const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

/** Tarjeta de confirmación: todo lo que el cliente necesita saber de una reserva, en un solo mensaje. */
function cardText(L: CardLabels, p: Proposal, simulated = false): string {
  const a = p.attrs;
  const start = day(a.starts_at);
  const end = day(a.ends_at);
  const lines = [
    `✔ ${L.confirmed}`,
    p.title,
    p.details,
    start ? `${L.dates}: ${start}${end && end !== start ? ` → ${end}` : ""}` : "",
    `${L.total}: ${money(p.amountEur)}`,
    p.reference ? `${L.reference}: ${p.reference}` : "",
    typeof a.cancel_by === "string" ? L.cancelUntil(when(a.cancel_by)) : p.kind === "hotel" ? L.noCancel : "",
    simulated ? L.test : p.verified ? L.verified : L.unverified,
    L.remind,
  ];
  return lines.filter(Boolean).join("\n");
}

export type MenuTexts = {
  main: string;
  mainLabel: string;
  rowNew: string;
  rowPlan: string;
  planAsk: string;
  rowBookings: string;
  rowPrefs: string;
  rowContact: (owner: string) => string;
  rowLang: string;
  whatNeed: string;
  typeFlight: string;
  typeHotel: string;
  typeFull: string;
  whereTo: string;
  destLabel: string;
  destOther: string;
  destAsk: string;
  destBad: string;
  nights: string;
  nightsOther: string;
  nightsAsk: string;
  nightsBad: string;
  date: string;
  dateLabel: string;
  dateOther: string;
  dateAsk: string;
  dateBad: string;
  originAsk: string;
  originBad: string;
  flights: (from: string, to: string, date: string) => string;
  hotels: (city: string, nights: number) => string;
  choose: string;
  recommended: string;
  direct: string;
  stops: (n: number) => string;
  refundable: string;
  perNight: string;
  stars: (n: number) => string;
  onlineCheckin: string;
  digitalKey: string;
  noFlights: string;
  noHotels: string;
  returnAsk: (date: string) => string;
  returnFlights: (from: string, to: string, date: string) => string;
  yes: string;
  no: string;
  done: string;
  bookingsNone: string;
  bookingsTitle: string;
  statusPending: string;
  statusApproved: string;
  statusConfirmed: string;
  statusVerified: string;
  refWord: string;
  prefsNone: string;
  prefsTitle: string;
  prefsFooter: string;
  prefLabels: Record<string, string>;
  yesWord: string;
  contactDone: (owner: string) => string;
  stale: string;
  flightTitle: (from: string, to: string, date: string, airline: string) => string;
  hotelDetails: (nights: number, date: string, stars: number) => string;
};

type Texts = {
  welcome: string;
  unsupported: string;
  error: string;
  alreadyHandled: string;
  approve: string;
  reject: string;
  approved: (title: string) => string;
  rejected: (title: string) => string;
  proposalPrompt: (p: Proposal) => string;
  rateAsk: string;
  rateLabel: string;
  scale: [string, string, string, string, string];
  askElements: string;
  yes: string;
  noThanks: string;
  elementAsk: (title: string) => string;
  skip: string;
  thanks: string;
  suggestion: (s: Suggestion) => string;
  suggestionYes: string;
  suggestionNo: string;
  suggestionAccepted: string;
  suggestionDeclined: string;
  menu: MenuTexts;
  /** Tarjeta de confirmación: referencia, fechas, importe y fecha límite de cancelación. */
  card: (p: Proposal, simulated?: boolean) => string;
  /** Petición que gestiona María por teléfono o email con el lugar. */
  manualRequested: (title: string) => string;
  bookingFailed: (title: string) => string;
  declined: (title: string) => string;
  reminder: (kind: ReminderKind, p: Proposal) => string;
};

export const T: Record<Lang, Texts> = {
  en: {
    welcome:
      "Welcome to VASSIST, your personal travel assistant. I am an AI assistant, not a person, and I only help with travel, to any destination and by any means: flights, trains, car trips, hotels, restaurants, activities and itineraries.\n\nNothing is ever booked or paid without your approval. Shall we plan your next trip? Where are you travelling to, and when?",
    unsupported: "For now I can only work in writing. Could you please send your request as a text message?",
    error: "I am sorry, something went wrong on my side. I have notified the team, and we will come back to you shortly.",
    alreadyHandled: "That request has already been handled.",
    approve: "Approve",
    reject: "Reject",
    approved: (t) =>
      `Thank you. Approved: ${t}.\nI have passed it on for confirmation and will let you know here as soon as it is confirmed. Nothing has been charged.`,
    rejected: (t) => `Understood, I have discarded: ${t}.\nWould you like me to look for an alternative?`,
    proposalPrompt: (p) => `${p.title}\n${p.details}\nTotal: ${money(p.amountEur)}\n\nDo you approve this option?`,
    rateAsk: "Your plan is complete. How would you rate it overall?",
    rateLabel: "Rate",
    scale: ["Poor", "Fair", "Good", "Very good", "Excellent"],
    askElements: "Thank you. Would you also like to rate the individual items? It is optional and helps me learn your preferences.",
    yes: "Yes",
    noThanks: "No, thank you",
    elementAsk: (t) => `How was: ${t}?`,
    skip: "Skip",
    thanks: "Thank you for your feedback. It has been noted.",
    suggestion: (s) => {
      const { n, avg } = s.evidence;
      switch (s.key) {
        case "preferred_airlines":
          return `I have noticed you rated ${n} flights with ${s.value} highly (average ${avg}/5). Shall I add ${s.value} to your preferred airlines?`;
        case "avoid_airlines":
          return `I have noticed you rated ${n} flights with ${s.value} poorly (average ${avg}/5). Shall I avoid ${s.value} in future searches?`;
        case "direct_only":
          return `You rated ${n} direct flights highly (average ${avg}/5). Shall I suggest only direct flights from now on?`;
        case "hotel_min_stars":
          return `You rated ${n} hotels of ${s.value} stars or more highly (average ${avg}/5). Shall I set ${s.value} stars as your minimum?`;
      }
    },
    suggestionYes: "Yes, update",
    suggestionNo: "No, keep as is",
    suggestionAccepted: "Done, I have updated your preferences.",
    suggestionDeclined: "Understood, I will keep things as they are.",
    menu: {
      main: "How can I help you today?",
      mainLabel: "Menu",
      rowNew: "Flights & hotels",
      rowPlan: "Plan any trip",
      planAsk: "With pleasure. Tell me in one message where you would like to go (any city, town or country), roughly when, and how you would like to travel (plane, train, car, or whatever suits best). I will ask for the rest: budget, who is travelling, preferences and interests.",
      rowBookings: "My bookings",
      rowPrefs: "My preferences",
      rowContact: (o) => `Talk to ${o}`,
      rowLang: "Language",
      whatNeed: "What do you need?",
      typeFlight: "Flight",
      typeHotel: "Hotel",
      typeFull: "Full trip",
      whereTo: "Where to?",
      destLabel: "Destination",
      destOther: "Other destination",
      destAsk: "Please write the destination city, or its 3-letter airport code, for example LHR.",
      destBad: "I could not match that place. Please send the 3-letter airport code of your destination, for example LHR, or write \"menu\" to start again.",
      nights: "How many nights?",
      nightsOther: "Other",
      nightsAsk: "Please write the number of nights.",
      nightsBad: "Please write a number of nights between 1 and 30.",
      date: "Departure date?",
      dateLabel: "Date",
      dateOther: "Another date",
      dateAsk: "Please write the date, for example 2026-11-12.",
      dateBad: "I could not read that date. Please use the format 2026-11-12, and a day in the future.",
      originAsk: "Which airport will you depart from? Please write the 3-letter code, for example RUH.",
      originBad: "Please send a 3-letter airport code, for example RUH.",
      flights: (f, t, d) => `Flights from ${f} to ${t} on ${d}:`,
      hotels: (c, n) => `Hotels in ${c} for ${n} night${n === 1 ? "" : "s"}:`,
      choose: "Choose",
      recommended: "recommended",
      direct: "direct",
      stops: (n) => `${n} stop${n === 1 ? "" : "s"}`,
      refundable: "refundable",
      perNight: "per night",
      stars: (n) => `${n} stars`,
      onlineCheckin: "online check-in",
      digitalKey: "digital key",
      noFlights: "I did not find flights for that day that match your preferences. Please choose another date.",
      noHotels: "I did not find hotels that match your preferences for those dates. You can write to me and I will look for alternatives.",
      returnAsk: (d) => `Would you like the return flight on ${d}?`,
      returnFlights: (f, t, d) => `Return flights from ${f} to ${t} on ${d}:`,
      yes: "Yes",
      no: "No, thank you",
      done: "Your proposals are above, waiting for your approval. You can write to me at any time if you want to change something.",
      bookingsNone: "You have no bookings yet.",
      bookingsTitle: "Your bookings:",
      statusPending: "waiting for your approval",
      statusApproved: "approved, being confirmed",
      statusConfirmed: "confirmed",
      statusVerified: "confirmed and verified",
      refWord: "Ref",
      prefsNone: "I have no saved preferences yet. Tell me what you prefer, for example: I like window seats and hotels with online check-in.",
      prefsTitle: "Your preferences:",
      prefsFooter: "To change any of them, just write to me.",
      prefLabels: {
        home_airport: "Home airport",
        preferred_airlines: "Preferred airlines",
        avoid_airlines: "Airlines to avoid",
        seat: "Seat",
        direct_only: "Direct flights only",
        hotel_min_stars: "Minimum hotel stars",
        require_online_checkin: "Online check-in required",
        diet: "Diet",
        budget: "Budget",
        transport_modes: "Preferred transport",
        interests: "Interests",
        pace: "Travel pace",
        accommodation: "Accommodation",
        notes: "Notes",
      },
      yesWord: "yes",
      contactDone: (o) => `I have alerted ${o}. She will reply to you here, in writing, as soon as she can.`,
      stale: "That option is no longer active. Here is the menu.",
      flightTitle: (f, t, d, a) => `Flight ${f} to ${t}, ${d}, ${a}`,
      hotelDetails: (n, d, s) => `${n} night${n === 1 ? "" : "s"} from ${d} · ${s} stars`,
    },
    card: (p, sim) => cardText(CARD.en, p, sim),
    manualRequested: (t) =>
      `Thank you. For ${t} our team needs to speak with the provider directly. Maria will contact them and write to you here. I cannot promise a time, and nothing has been charged.`,
    bookingFailed: (t) => `I am sorry, I could not complete the booking of ${t}. I have notified Maria, who will write to you here. Nothing has been charged.`,
    declined: (t) => `I am sorry, ${t} is not possible. Would you like me to look for an alternative?`,
    reminder: (kind, p) => {
      const a = p.attrs;
      const link = typeof a.checkin_url === "string" ? a.checkin_url : "";
      switch (kind) {
        case "flight_checkin":
          return `Reminder: ${p.title}, departing ${when(a.starts_at)}.\nOnline check-in usually opens about 24 hours before departure, although each airline sets its own time. ${link ? `Official link: ${link}` : "Please use the airline's website or app."}\nI cannot complete the check-in for you yet.`;
        case "hotel_checkin":
          return `Reminder: ${p.title}, check-in ${when(a.starts_at)}.\n${a.online_checkin === true && link ? `You can complete online check-in here: ${link}` : a.online_checkin === true ? "The hotel offers online check-in; please use the link in your booking confirmation." : "Check-in is at the reception."}${a.digital_key === true ? "\nThe hotel offers a digital key on your phone." : ""}\nIf you would like an early check-in, tell me and I will prepare the request.`;
        case "hotel_checkout":
          return `Reminder: check-out from ${p.title} is ${when(a.ends_at)}.\nIf you need a late check-out, tell me and I will prepare the request.`;
        case "cancel_deadline":
          return `Reminder: free cancellation for ${p.title} ends ${when(p.attrs.cancel_by)}. If your plans may change, tell me before then and I will prepare the cancellation.`;
      }
    },
  },
  es: {
    welcome:
      "Bienvenido a VASSIST, su asistente personal de viajes. Soy un asistente de inteligencia artificial, no una persona, y solo le ayudo con viajes, a cualquier destino y por cualquier medio: vuelos, trenes, viajes en coche, hoteles, restaurantes, actividades e itinerarios.\n\nNunca se reserva ni se paga nada sin su aprobación. ¿Planificamos su próximo viaje? ¿A dónde viaja y cuándo?",
    unsupported: "Por ahora solo puedo trabajar por escrito. ¿Podría enviarme su petición como mensaje de texto, por favor?",
    error: "Lo siento, algo ha fallado por mi parte. He avisado al equipo y le responderemos en breve.",
    alreadyHandled: "Esa petición ya se ha gestionado.",
    approve: "Aprobar",
    reject: "Rechazar",
    approved: (t) => `Gracias. Aprobado: ${t}.\nLo he pasado para su confirmación y le avisaré aquí en cuanto esté confirmado. No se ha cobrado nada.`,
    rejected: (t) => `Entendido, he descartado: ${t}.\n¿Quiere que busque una alternativa?`,
    proposalPrompt: (p) => `${p.title}\n${p.details}\nTotal: ${money(p.amountEur)}\n\n¿Aprueba esta opción?`,
    rateAsk: "Su plan está completo. ¿Cómo lo valoraría en conjunto?",
    rateLabel: "Valorar",
    scale: ["Malo", "Regular", "Bueno", "Muy bueno", "Excelente"],
    askElements: "Gracias. ¿Quiere valorar también cada elemento? Es opcional y me ayuda a conocer sus preferencias.",
    yes: "Sí",
    noThanks: "No, gracias",
    elementAsk: (t) => `¿Qué tal: ${t}?`,
    skip: "Omitir",
    thanks: "Gracias por su opinión. Queda anotada.",
    suggestion: (s) => {
      const { n, avg } = s.evidence;
      switch (s.key) {
        case "preferred_airlines":
          return `He visto que valoró bien ${n} vuelos con ${s.value} (media ${avg}/5). ¿Añado ${s.value} a sus aerolíneas preferidas?`;
        case "avoid_airlines":
          return `He visto que valoró mal ${n} vuelos con ${s.value} (media ${avg}/5). ¿Evito ${s.value} en las próximas búsquedas?`;
        case "direct_only":
          return `Valoró bien ${n} vuelos directos (media ${avg}/5). ¿Le propongo solo vuelos directos a partir de ahora?`;
        case "hotel_min_stars":
          return `Valoró bien ${n} hoteles de ${s.value} estrellas o más (media ${avg}/5). ¿Fijo ${s.value} estrellas como mínimo?`;
      }
    },
    suggestionYes: "Sí, actualizar",
    suggestionNo: "No, dejarlo así",
    suggestionAccepted: "Hecho, he actualizado sus preferencias.",
    suggestionDeclined: "Entendido, lo dejo como está.",
    menu: {
      main: "¿En qué puedo ayudarle hoy?",
      mainLabel: "Menú",
      rowNew: "Vuelos y hoteles",
      rowPlan: "Planificar un viaje",
      rowLang: "Idioma",
      planAsk: "Con gusto. Cuénteme en un mensaje a dónde quiere ir (cualquier ciudad, pueblo o país), más o menos cuándo y cómo le gustaría viajar (avión, tren, coche u otro). Le preguntaré el resto: presupuesto, quién viaja, preferencias e intereses.",
      rowBookings: "Mis reservas",
      rowPrefs: "Mis preferencias",
      rowContact: (o) => `Hablar con ${o}`,
      whatNeed: "¿Qué necesita?",
      typeFlight: "Vuelo",
      typeHotel: "Hotel",
      typeFull: "Viaje completo",
      whereTo: "¿A dónde?",
      destLabel: "Destino",
      destOther: "Otro destino",
      destAsk: "Escriba la ciudad de destino o su código de aeropuerto de 3 letras, por ejemplo LHR.",
      destBad: "No he podido reconocer ese lugar. Envíeme el código de aeropuerto de 3 letras del destino, por ejemplo LHR, o escriba \"menú\" para empezar de nuevo.",
      nights: "¿Cuántas noches?",
      nightsOther: "Otro número",
      nightsAsk: "Escriba el número de noches.",
      nightsBad: "Escriba un número de noches entre 1 y 30.",
      date: "¿Fecha de salida?",
      dateLabel: "Fecha",
      dateOther: "Otra fecha",
      dateAsk: "Escriba la fecha, por ejemplo 2026-11-12.",
      dateBad: "No he podido leer esa fecha. Use el formato 2026-11-12 y un día futuro.",
      originAsk: "¿Desde qué aeropuerto saldrá? Escriba el código de 3 letras, por ejemplo AGP.",
      originBad: "Envíeme un código de aeropuerto de 3 letras, por ejemplo AGP.",
      flights: (f, t, d) => `Vuelos de ${f} a ${t} el ${d}:`,
      hotels: (c, n) => `Hoteles en ${c} para ${n} noche${n === 1 ? "" : "s"}:`,
      choose: "Elegir",
      recommended: "recomendado",
      direct: "directo",
      stops: (n) => `${n} escala${n === 1 ? "" : "s"}`,
      refundable: "reembolsable",
      perNight: "por noche",
      stars: (n) => `${n} estrellas`,
      onlineCheckin: "check-in online",
      digitalKey: "llave digital",
      noFlights: "No he encontrado vuelos ese día que encajen con sus preferencias. Elija otra fecha, por favor.",
      noHotels: "No he encontrado hoteles que encajen con sus preferencias en esas fechas. Escríbame y buscaré alternativas.",
      returnAsk: (d) => `¿Quiere el vuelo de vuelta el ${d}?`,
      returnFlights: (f, t, d) => `Vuelos de vuelta de ${f} a ${t} el ${d}:`,
      yes: "Sí",
      no: "No, gracias",
      done: "Sus propuestas están arriba, a la espera de su aprobación. Puede escribirme en cualquier momento si quiere cambiar algo.",
      bookingsNone: "Todavía no tiene reservas.",
      bookingsTitle: "Sus reservas:",
      statusPending: "pendiente de su aprobación",
      statusApproved: "aprobada, en proceso de confirmación",
      statusConfirmed: "confirmada",
      statusVerified: "confirmada y verificada",
      refWord: "Ref",
      prefsNone: "Todavía no tengo preferencias guardadas. Cuénteme qué prefiere, por ejemplo: me gusta el asiento de ventanilla y los hoteles con check-in online.",
      prefsTitle: "Sus preferencias:",
      prefsFooter: "Para cambiar alguna, escríbame.",
      prefLabels: {
        home_airport: "Aeropuerto de origen",
        preferred_airlines: "Aerolíneas preferidas",
        avoid_airlines: "Aerolíneas a evitar",
        seat: "Asiento",
        direct_only: "Solo vuelos directos",
        hotel_min_stars: "Estrellas mínimas del hotel",
        require_online_checkin: "Check-in online obligatorio",
        diet: "Dieta",
        budget: "Presupuesto",
        transport_modes: "Transporte preferido",
        interests: "Intereses",
        pace: "Ritmo de viaje",
        accommodation: "Alojamiento",
        notes: "Notas",
      },
      yesWord: "sí",
      contactDone: (o) => `He avisado a ${o}. Le responderá aquí, por escrito, en cuanto pueda.`,
      stale: "Esa opción ya no está activa. Aquí tiene el menú.",
      flightTitle: (f, t, d, a) => `Vuelo ${f} a ${t}, ${d}, ${a}`,
      hotelDetails: (n, d, s) => `${n} noche${n === 1 ? "" : "s"} desde el ${d} · ${s} estrellas`,
    },
    card: (p, sim) => cardText(CARD.es, p, sim),
    manualRequested: (t) =>
      `Gracias. Para ${t} nuestro equipo necesita hablar directamente con el proveedor. María contactará con ellos y le escribirá aquí. No puedo prometer un plazo y no se ha cobrado nada.`,
    bookingFailed: (t) => `Lo siento, no he podido completar la reserva de ${t}. He avisado a María, que le escribirá aquí. No se ha cobrado nada.`,
    declined: (t) => `Lo siento, ${t} no es posible. ¿Quiere que busque una alternativa?`,
    reminder: (kind, p) => {
      const a = p.attrs;
      const link = typeof a.checkin_url === "string" ? a.checkin_url : "";
      switch (kind) {
        case "flight_checkin":
          return `Recordatorio: ${p.title}, salida ${when(a.starts_at)}.\nEl check-in online suele abrir unas 24 horas antes de la salida, aunque cada aerolínea fija su plazo. ${link ? `Enlace oficial: ${link}` : "Use la web o la app de la aerolínea."}\nTodavía no puedo hacer el check-in por usted.`;
        case "hotel_checkin":
          return `Recordatorio: ${p.title}, check-in ${when(a.starts_at)}.\n${a.online_checkin === true && link ? `Puede hacer el check-in online aquí: ${link}` : a.online_checkin === true ? "El hotel ofrece check-in online; use el enlace de su confirmación de reserva." : "El check-in es en recepción."}${a.digital_key === true ? "\nEl hotel ofrece llave digital en el móvil." : ""}\nSi quiere un check-in anticipado, dígamelo y preparo la solicitud.`;
        case "hotel_checkout":
          return `Recordatorio: el check-out de ${p.title} es ${when(a.ends_at)}.\nSi necesita un check-out tardío, dígamelo y preparo la solicitud.`;
        case "cancel_deadline":
          return `Recordatorio: la cancelación gratuita de ${p.title} termina el ${when(p.attrs.cancel_by)}. Si sus planes pueden cambiar, dígamelo antes y preparo la cancelación.`;
      }
    },
  },
  ar: {
    welcome:
      "أهلاً بكم في VASSIST، مساعدكم الشخصي للسفر. أنا مساعد آلي يعمل بالذكاء الاصطناعي ولست إنساناً، وأقتصر على خدمات السفر إلى أي وجهة وبأي وسيلة: الطائرة والقطار والسيارة والفنادق والمطاعم والأنشطة وجداول الرحلات.\n\nلا يتم أي حجز ولا دفع دون موافقتكم. هل نبدأ بالتخطيط لرحلتكم القادمة؟ إلى أين تودّون السفر، ومتى؟",
    unsupported: "أعمل حالياً بالكتابة فقط. هل يمكنكم إرسال طلبكم في رسالة نصية من فضلكم؟",
    error: "نعتذر، حدث خلل من جانبنا. لقد أبلغنا الفريق وسنعود إليكم قريباً.",
    alreadyHandled: "تمت معالجة هذا الطلب مسبقاً.",
    approve: "موافقة",
    reject: "رفض",
    approved: (t) => `شكراً لكم. تمت الموافقة على: ${t}.\nأحلتُه للتأكيد وسأوافيكم هنا فور تأكيده. لم يتم خصم أي مبلغ.`,
    rejected: (t) => `حسناً، تم استبعاد: ${t}.\nهل تودّون أن أبحث لكم عن بديل؟`,
    proposalPrompt: (p) => `${p.title}\n${p.details}\nالإجمالي: ${money(p.amountEur)}\n\nهل توافقون على هذا الخيار؟`,
    rateAsk: "اكتملت خطتكم. كيف تقيّمونها بشكل عام؟",
    rateLabel: "التقييم",
    scale: ["ضعيف", "مقبول", "جيد", "جيد جداً", "ممتاز"],
    askElements: "شكراً لكم. هل تودّون أيضاً تقييم كل عنصر على حدة؟ هذا اختياري ويساعدني على معرفة تفضيلاتكم.",
    yes: "نعم",
    noThanks: "لا، شكراً",
    elementAsk: (t) => `كيف كان: ${t}؟`,
    skip: "تخطي",
    thanks: "شكراً لملاحظاتكم، تم تسجيلها.",
    suggestion: (s) => {
      const { n, avg } = s.evidence;
      switch (s.key) {
        case "preferred_airlines":
          return `لاحظتُ أنكم قيّمتم ${n} رحلات على ${s.value} تقييماً مرتفعاً (المتوسط ${avg} من 5). هل أضيف ${s.value} إلى شركات الطيران المفضلة لديكم؟`;
        case "avoid_airlines":
          return `لاحظتُ أنكم قيّمتم ${n} رحلات على ${s.value} تقييماً منخفضاً (المتوسط ${avg} من 5). هل أتجنب ${s.value} في عمليات البحث القادمة؟`;
        case "direct_only":
          return `قيّمتم ${n} رحلات مباشرة تقييماً مرتفعاً (المتوسط ${avg} من 5). هل أقترح لكم الرحلات المباشرة فقط من الآن؟`;
        case "hotel_min_stars":
          return `قيّمتم ${n} فنادق من ${s.value} نجوم فأكثر تقييماً مرتفعاً (المتوسط ${avg} من 5). هل أجعل ${s.value} نجوم الحد الأدنى لديكم؟`;
      }
    },
    suggestionYes: "نعم، حدّث",
    suggestionNo: "لا، أبقِ كما هو",
    suggestionAccepted: "تم، حدّثتُ تفضيلاتكم.",
    suggestionDeclined: "حسناً، سأُبقي الأمور كما هي.",
    menu: {
      main: "كيف يمكنني مساعدتكم اليوم؟",
      mainLabel: "القائمة",
      rowNew: "رحلات وفنادق",
      rowPlan: "تخطيط أي رحلة",
      planAsk: "بكل سرور. أخبروني في رسالة واحدة إلى أين تودون الذهاب (أي مدينة أو بلدة أو دولة)، وفي أي وقت تقريباً، وبأي وسيلة تفضلون السفر (طائرة أو قطار أو سيارة أو ما يناسبكم). وسأسألكم عن الباقي: الميزانية وعدد المسافرين والتفضيلات والاهتمامات.",
      rowBookings: "حجوزاتي",
      rowPrefs: "تفضيلاتي",
      rowContact: (o) => `التواصل مع ${o}`,
      rowLang: "اللغة",
      whatNeed: "ماذا تحتاجون؟",
      typeFlight: "رحلة جوية",
      typeHotel: "فندق",
      typeFull: "رحلة كاملة",
      whereTo: "إلى أين؟",
      destLabel: "الوجهة",
      destOther: "وجهة أخرى",
      destAsk: "من فضلكم اكتبوا اسم مدينة الوجهة أو رمز المطار المكوّن من 3 أحرف، مثل LHR.",
      destBad: "لم أتعرف على هذا المكان. أرسلوا رمز مطار الوجهة المكوّن من 3 أحرف، مثل LHR، أو اكتبوا \"القائمة\" للبدء من جديد.",
      nights: "كم ليلة؟",
      nightsOther: "غير ذلك",
      nightsAsk: "من فضلكم اكتبوا عدد الليالي.",
      nightsBad: "من فضلكم اكتبوا عدد ليالٍ بين 1 و30.",
      date: "تاريخ المغادرة؟",
      dateLabel: "التاريخ",
      dateOther: "تاريخ آخر",
      dateAsk: "من فضلكم اكتبوا التاريخ، مثل 2026-11-12.",
      dateBad: "لم أستطع قراءة هذا التاريخ. استخدموا الصيغة 2026-11-12 ويوماً في المستقبل.",
      originAsk: "من أي مطار ستغادرون؟ اكتبوا الرمز المكوّن من 3 أحرف، مثل RUH.",
      originBad: "من فضلكم أرسلوا رمز مطار من 3 أحرف، مثل RUH.",
      flights: (f, t, d) => `الرحلات من ${f} إلى ${t} بتاريخ ${d}:`,
      hotels: (c, n) => `الفنادق في ${c} لمدة ${n} ليالٍ:`,
      choose: "اختيار",
      recommended: "موصى بها",
      direct: "مباشرة",
      stops: (n) => `${n} توقف`,
      refundable: "قابلة للاسترداد",
      perNight: "لليلة",
      stars: (n) => `${n} نجوم`,
      onlineCheckin: "تسجيل وصول إلكتروني",
      digitalKey: "مفتاح رقمي",
      noFlights: "لم أجد رحلات في ذلك اليوم تناسب تفضيلاتكم. من فضلكم اختاروا تاريخاً آخر.",
      noHotels: "لم أجد فنادق تناسب تفضيلاتكم في تلك التواريخ. اكتبوا لي وسأبحث عن بدائل.",
      returnAsk: (d) => `هل تودّون رحلة العودة بتاريخ ${d}؟`,
      returnFlights: (f, t, d) => `رحلات العودة من ${f} إلى ${t} بتاريخ ${d}:`,
      yes: "نعم",
      no: "لا، شكراً",
      done: "مقترحاتكم أعلاه بانتظار موافقتكم. يمكنكم مراسلتي في أي وقت إذا أردتم تغيير شيء.",
      bookingsNone: "ليست لديكم حجوزات بعد.",
      bookingsTitle: "حجوزاتكم:",
      statusPending: "بانتظار موافقتكم",
      statusApproved: "تمت الموافقة، قيد التأكيد",
      statusConfirmed: "مؤكدة",
      statusVerified: "مؤكدة وتم التحقق منها",
      refWord: "المرجع",
      prefsNone: "لا توجد لدي تفضيلات محفوظة بعد. أخبروني بما تفضلون، مثل: أفضّل مقاعد النافذة والفنادق التي توفر تسجيل وصول إلكترونياً.",
      prefsTitle: "تفضيلاتكم:",
      prefsFooter: "لتغيير أي منها، اكتبوا لي ببساطة.",
      prefLabels: {
        home_airport: "المطار الرئيسي",
        preferred_airlines: "شركات الطيران المفضلة",
        avoid_airlines: "شركات طيران يُفضّل تجنبها",
        seat: "المقعد",
        direct_only: "الرحلات المباشرة فقط",
        hotel_min_stars: "الحد الأدنى لنجوم الفندق",
        require_online_checkin: "تسجيل الوصول الإلكتروني مطلوب",
        diet: "النظام الغذائي",
        budget: "الميزانية",
        transport_modes: "وسائل النقل المفضلة",
        interests: "الاهتمامات",
        pace: "وتيرة السفر",
        accommodation: "الإقامة",
        notes: "ملاحظات",
      },
      yesWord: "نعم",
      contactDone: (o) => `لقد نبّهتُ ${o}، وسترد عليكم هنا كتابةً في أقرب وقت ممكن.`,
      stale: "هذا الخيار لم يعد متاحاً. إليكم القائمة.",
      flightTitle: (f, t, d, a) => `رحلة ${f} إلى ${t}، ${d}، ${a}`,
      hotelDetails: (n, d, s) => `${n} ليالٍ ابتداءً من ${d} · ${s} نجوم`,
    },
    card: (p, sim) => cardText(CARD.ar, p, sim),
    manualRequested: (t) => `شكراً لكم. بالنسبة إلى ${t}، يحتاج فريقنا إلى التواصل مع الجهة مباشرة. ستتواصل ماريا معهم وتكتب لكم هنا. لا أستطيع الوعد بموعد محدد، ولم يتم خصم أي مبلغ.`,
    bookingFailed: (t) => `نعتذر، لم أتمكن من إتمام حجز ${t}. أبلغتُ ماريا وستكتب لكم هنا. لم يتم خصم أي مبلغ.`,
    declined: (t) => `نعتذر، ${t} غير متاح. هل تودون أن أبحث عن بديل؟`,
    reminder: (kind, p) => {
      const a = p.attrs;
      const link = typeof a.checkin_url === "string" ? a.checkin_url : "";
      switch (kind) {
        case "flight_checkin":
          return `تذكير: ${p.title}، الإقلاع ${when(a.starts_at)}.\nيفتح تسجيل الوصول عبر الإنترنت عادةً قبل الإقلاع بنحو 24 ساعة، لكن لكل شركة طيران موعدها. ${link ? `الرابط الرسمي: ${link}` : "يرجى استخدام موقع شركة الطيران أو تطبيقها."}\nلا أستطيع إتمام تسجيل الوصول نيابةً عنكم حالياً.`;
        case "hotel_checkin":
          return `تذكير: ${p.title}، تسجيل الوصول ${when(a.starts_at)}.\n${a.online_checkin === true && link ? `يمكنكم إتمام تسجيل الوصول عبر الإنترنت من هنا: ${link}` : a.online_checkin === true ? "يوفّر الفندق تسجيل الوصول عبر الإنترنت؛ يرجى استخدام الرابط الوارد في تأكيد الحجز." : "تسجيل الوصول يتم عند الاستقبال."}${a.digital_key === true ? "\nيوفّر الفندق مفتاحاً رقمياً على هاتفكم." : ""}\nإذا رغبتم في تسجيل وصول مبكر، أخبروني وسأجهّز الطلب.`;
        case "hotel_checkout":
          return `تذكير: موعد المغادرة من ${p.title} هو ${when(a.ends_at)}.\nإذا احتجتم إلى مغادرة متأخرة، أخبروني وسأجهّز الطلب.`;
        case "cancel_deadline":
          return `تذكير: ينتهي الإلغاء المجاني لـ ${p.title} في ${when(p.attrs.cancel_by)}. إذا قد تتغير خططكم، أخبروني قبل ذلك وسأجهّز الإلغاء.`;
      }
    },
  },
};
