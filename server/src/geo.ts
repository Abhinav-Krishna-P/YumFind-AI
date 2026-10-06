const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat: number, lng: number, precision = 6) {
  let idx = 0;
  let bit = 0;
  let even = true;
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx *= 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx *= 2;
        latMax = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function validCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function normalizeCraving(q: string) {
  return q
    .toLowerCase()
    .replace(/\b(near me|nearby|best)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dishQuery(q: string) {
  return q
    .replace(
      /\b(i need|i want|i would like|i'd like|looking for|find me|show me|please|the best|best|near me|nearby|around me)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(input: {
  lat: number;
  lng: number;
  craving: string;
  radiusM: number;
  preferences: string[];
  addons: string[];
  wantsBest: boolean;
}) {
  return [
    geohash(input.lat, input.lng, 6),
    normalizeCraving(input.craving),
    input.radiusM,
    [...input.preferences].sort().join(','),
    [...input.addons].sort().join(','),
    'open',
    input.wantsBest ? 'best' : 'any',
  ].join('|');
}

export function words(text: string, max: number) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, max).join(' ');
}
