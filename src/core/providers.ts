/**
 * Proveedores de viajes. Ahora devuelven datos simulados (mock) para desarrollar
 * y probar el flujo completo sin coste. Para datos reales, implementa esta misma
 * interfaz con un proveedor (p. ej. Duffel, aún por verificar) y cambia `providers`.
 */
export type FlightOption = {
  id: string;
  airline: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  stops: number;
  priceEur: number;
  refundable: boolean;
};

export type HotelOption = {
  id: string;
  name: string;
  city: string;
  /** hotel o apartamento turístico. */
  type: "hotel" | "apartment";
  stars: number;
  pricePerNightEur: number;
  freeCancellation: boolean;
  distanceToCenterKm: number;
  /** El hotel ofrece pre-registro/check-in online. */
  onlineCheckin: boolean;
  /** El hotel ofrece llave digital en el móvil. */
  digitalKey: boolean;
  /** Ubicación y foto. Con datos de prueba son de muestra: ubicación aproximada y foto genérica. */
  lat?: number;
  lon?: number;
  imageUrl?: string;
  sample?: boolean;
};

export type BookingResult = { ok: true; reference: string; simulated: boolean } | { ok: false; reason: string };

export interface TravelProvider {
  searchFlights(p: { from: string; to: string; date: string; returnDate?: string }): Promise<FlightOption[]>;
  /** Reserva real (vuelo u hotel) con el proveedor. El de pruebas solo la simula y lo declara. */
  book(p: { kind: "flight" | "hotel"; title: string; amountEur: number; proposalId: string }): Promise<BookingResult>;
  searchHotels(p: { city: string; checkIn: string; checkOut: string; minStars?: number; onlineCheckinOnly?: boolean; includeApartments?: boolean }): Promise<HotelOption[]>;
}

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const AIRLINES = ["Iberia", "Saudia", "Lufthansa", "Air France", "KLM", "British Airways", "Emirates"];
const HOTEL_NAMES = ["Gran Hotel Central", "Boutique Plaza", "Hotel del Parque", "Residencia Norte", "Suites Mirador"];
const APARTMENT_NAMES = ["Apartamento Centro", "Loft Mirador"];
const pad = (n: number) => String(n).padStart(2, "0");

export const mockProvider: TravelProvider = {
  async searchFlights({ from, to, date }) {
    const rand = seeded(`${from}-${to}-${date}`);
    return Array.from({ length: 4 }, (_, i) => {
      const dep = 6 + Math.floor(rand() * 14);
      const dur = 1 + Math.floor(rand() * 6);
      return {
        id: `FL-${from}${to}-${i + 1}`,
        airline: AIRLINES[Math.floor(rand() * AIRLINES.length)]!,
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        departure: `${date}T${pad(dep)}:${pad(Math.floor(rand() * 4) * 15)}`,
        arrival: `${date}T${pad((dep + dur) % 24)}:${pad(Math.floor(rand() * 4) * 15)}`,
        stops: rand() > 0.7 ? 1 : 0,
        priceEur: Math.round(90 + rand() * 450),
        refundable: rand() > 0.5,
      };
    }).sort((a, b) => a.priceEur - b.priceEur);
  },

  async book({ proposalId }) {
    return { ok: true, reference: `SIM-${proposalId.slice(0, 6).toUpperCase()}`, simulated: true };
  },

  async searchHotels({ city, checkIn, minStars = 3, onlineCheckinOnly = false, includeApartments = false }) {
    const rand = seeded(`${city}-${checkIn}`);
    const make = (name: string, i: number, type: "hotel" | "apartment"): HotelOption => ({
      id: `${type === "hotel" ? "HT" : "AP"}-${city.slice(0, 3).toUpperCase()}-${i + 1}`,
      name: `${name} ${city}`,
      city,
      type,
      stars: 3 + Math.floor(rand() * 3),
      pricePerNightEur: Math.round(70 + rand() * 280),
      freeCancellation: rand() > 0.4,
      distanceToCenterKm: Math.round(rand() * 80) / 10,
      onlineCheckin: rand() > 0.35,
      digitalKey: rand() > 0.6,
    });
    const hotels = HOTEL_NAMES.slice(0, 4).map((n, i) => make(n, i, "hotel")).filter((h) => h.stars >= minStars);
    const apartments = includeApartments ? APARTMENT_NAMES.map((n, i) => make(n, i, "apartment")) : [];
    const c = coordsFor(city);
    const withMedia = (h: HotelOption): HotelOption => ({
      ...h,
      sample: true,
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(h.id + city)}/800/500`,
      ...(c ? { lat: Math.round((c[0] + (rand() - 0.5) * 0.03) * 1e5) / 1e5, lon: Math.round((c[1] + (rand() - 0.5) * 0.03) * 1e5) / 1e5 } : {}),
    });
    return [...hotels, ...apartments].map(withMedia)
      .filter((h) => !onlineCheckinOnly || h.onlineCheckin)
      .sort((a, b) => a.pricePerNightEur - b.pricePerNightEur);
  },
};

export const providers: TravelProvider = mockProvider;

/** Centro aproximado de las ciudades conocidas, para el pin de muestra. */
const COORDS: Record<string, [number, number]> = {
  LHR: [51.507, -0.128], CDG: [48.857, 2.352], ZRH: [47.377, 8.541], JFK: [40.713, -74.006], DXB: [25.205, 55.271],
  RUH: [24.714, 46.675], JED: [21.543, 39.173], MED: [24.468, 39.611], DMM: [26.428, 50.103], MAD: [40.417, -3.704],
  BCN: [41.385, 2.173], AGP: [36.721, -4.421], SVQ: [37.389, -5.984], XRY: [36.686, -6.137], GRX: [37.177, -3.599],
  VLC: [39.470, -0.376], LIS: [38.722, -9.139], FCO: [41.903, 12.496], FRA: [50.110, 8.682], IST: [41.008, 28.978],
  CAI: [30.044, 31.236], DOH: [25.286, 51.531], GVA: [46.204, 6.143], MXP: [45.464, 9.190], VIE: [48.208, 16.374],
  AMS: [52.368, 4.904], BER: [52.520, 13.405], MUC: [48.135, 11.582], RAK: [31.629, -7.981], CMN: [33.573, -7.589],
};
export function coordsFor(place: string): [number, number] | null {
  const iata = iataFor(place);
  return iata ? (COORDS[iata] ?? null) : null;
}

/**
 * Datos de apoyo para el entorno de pruebas. Con un proveedor real, las horas ya llevan su
 * zona horaria y esta tabla deja de hacer falta.
 */
/** [nombre, IATA, desfase de ejemplo, ...alias]. Los alias admiten nombres en español y ciudades servidas por ese aeropuerto. */
const CITIES: [string, string, string, ...string[]][] = [
  ["London", "LHR", "+01:00", "londres"],
  ["Paris", "CDG", "+02:00"],
  ["Zurich", "ZRH", "+02:00"],
  ["New York", "JFK", "-04:00", "nueva york"],
  ["Dubai", "DXB", "+04:00"],
  ["Riyadh", "RUH", "+03:00", "riad"],
  ["Jeddah", "JED", "+03:00", "yeda"],
  ["Medina", "MED", "+03:00", "madinah"],
  ["Dammam", "DMM", "+03:00"],
  ["Madrid", "MAD", "+02:00"],
  ["Barcelona", "BCN", "+02:00"],
  ["Malaga", "AGP", "+02:00"],
  ["Seville", "SVQ", "+02:00", "sevilla"],
  ["Jerez", "XRY", "+02:00", "cadiz", "vejer de la frontera", "vejer", "sanlucar de barrameda"],
  ["Granada", "GRX", "+02:00"],
  ["Valencia", "VLC", "+02:00"],
  ["Lisbon", "LIS", "+01:00", "lisboa"],
  ["Rome", "FCO", "+02:00", "roma"],
  ["Frankfurt", "FRA", "+02:00"],
  ["Istanbul", "IST", "+03:00", "estambul"],
  ["Cairo", "CAI", "+03:00", "el cairo"],
  ["Doha", "DOH", "+03:00"],
  ["Geneva", "GVA", "+02:00", "ginebra"],
  ["Milan", "MXP", "+02:00", "milano"],
  ["Vienna", "VIE", "+02:00", "viena"],
  ["Amsterdam", "AMS", "+02:00"],
  ["Berlin", "BER", "+02:00"],
  ["Munich", "MUC", "+02:00", "munchen", "munich"],
  ["Marrakech", "RAK", "+01:00", "marrakesh"],
  ["Casablanca", "CMN", "+01:00"],
];
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const CITY_IATA: Record<string, string> = {};
const IATA_CITY: Record<string, string> = {};
const IATA_OFFSET: Record<string, string> = {};
for (const [name, iata, offset, ...aliases] of CITIES) {
  for (const k of [name, ...aliases]) CITY_IATA[norm(k)] = iata;
  IATA_CITY[iata] = name;
  IATA_OFFSET[iata] = offset;
}

/** Código IATA de una ciudad conocida (con o sin tildes), o el propio texto si ya es un código de 3 letras. */
export function iataFor(place: string): string | null {
  const t = place.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  return CITY_IATA[norm(t)] ?? null;
}
export const cityFor = (iata: string): string => IATA_CITY[iata.toUpperCase()] ?? iata.toUpperCase();
/** Desfase horario de ejemplo de un aeropuerto, p. ej. "+03:00". Desconocido: UTC. */
export const offsetFor = (iata: string): string => IATA_OFFSET[iata.toUpperCase()] ?? "+00:00";
