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
};

export interface TravelProvider {
  searchFlights(p: { from: string; to: string; date: string; returnDate?: string }): Promise<FlightOption[]>;
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
    return [...hotels, ...apartments]
      .filter((h) => !onlineCheckinOnly || h.onlineCheckin)
      .sort((a, b) => a.pricePerNightEur - b.pricePerNightEur);
  },
};

export const providers: TravelProvider = mockProvider;

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
