import { geohash } from './geo.js';

type NominatimAddress = Partial<
  Record<
    | 'road'
    | 'neighbourhood'
    | 'suburb'
    | 'quarter'
    | 'city_district'
    | 'village'
    | 'town'
    | 'city'
    | 'municipality'
    | 'county'
    | 'state_district'
    | 'state',
    string
  >
>;

// ~150 m cells: nearby fixes share one lookup and we stay well inside Nominatim's 1 req/s policy.
const cache = new Map<string, string | null>();
const MAX_CACHE = 2000;

function labelOf(address: NominatimAddress) {
  const area =
    address.neighbourhood || address.suburb || address.quarter || address.city_district || address.road || null;
  const city =
    address.city || address.town || address.village || address.municipality || address.county || address.state_district || address.state || null;
  return [area, city].filter((part, i, all) => part && all.indexOf(part) === i).join(', ') || null;
}

// Nominatim allows one request per second per app: queue upstream calls at least 1.1 s apart.
let nextSlot = 0;
const MAX_QUEUE_MS = 6000;

/** Waits for a free slot; false when the queue is too deep to answer in time. */
async function inTurn() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  if (wait > MAX_QUEUE_MS) return false;
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  return true;
}

/** Human-readable "Area, City" for a coordinate, via OpenStreetMap Nominatim. */
export async function placeName(lat: number, lng: number, signal: AbortSignal) {
  const key = geohash(lat, lng, 7);
  if (cache.has(key)) return cache.get(key) ?? null;

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '16',
    addressdetails: '1',
    'accept-language': 'en',
  }).toString();

  if (!(await inTurn())) return null;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'YumFindAI/1.0 (local dev)' } });
  if (!res.ok) return null;
  const json = (await res.json()) as { address?: NominatimAddress };
  const label = json.address ? labelOf(json.address) : null;

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, label);
  return label;
}
