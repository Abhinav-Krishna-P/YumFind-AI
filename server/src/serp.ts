import { env } from './env.js';
import type { Review } from './types.js';
import { HttpError } from './types.js';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const RESTRICTOR =
  'local_results[].{title,place_id,data_id,gps_coordinates,rating,reviews,price,open_state,operating_hours,thumbnail,address,phone,website}';

type Query = Record<string, string | number | boolean | undefined>;

async function callSerp(params: Query, signal?: AbortSignal) {
  if (!env.serp) throw new HttpError(503, 'Search is not configured');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('api_key', env.serp);
  url.searchParams.set('google_domain', 'google.co.in');
  url.searchParams.set('gl', 'in');
  url.searchParams.set('hl', 'en');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { signal });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.error) {
    const message = typeof body.error === 'string' ? body.error : 'Search is unavailable';
    throw new HttpError(503, message);
  }
  return body;
}

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceLevel(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const marks = value.match(/[₹$]/g);
  return marks?.length ? marks.length : null;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export type SerpPlace = {
  dataId: string;
  googlePlaceId: string | null;
  reviewWith: { data_id?: string; place_id?: string };
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  reviewsCount: number | null;
  priceLevel: number | null;
  openNow: boolean | null;
  thumbnail: string | null;
  phone: string | null;
  website: string | null;
  /** Weekly hours as Google shows them, e.g. { monday: "11 am–1 am" }. */
  hours: Record<string, string> | null;
};

function readPlaces(body: Record<string, unknown>): SerpPlace[] {
  const rows = Array.isArray(body.local_results) ? body.local_results : [];
  const places: SerpPlace[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const gps = item.gps_coordinates as { latitude?: number; longitude?: number } | undefined;
    const lat = num(gps?.latitude);
    const lng = num(gps?.longitude);
    const name = text(item.title);
    const googlePlaceId = text(item.place_id);
    const rawDataId = text(item.data_id);
    if (lat == null || lng == null || !name) continue;
    const dataId = rawDataId || (googlePlaceId ? `pid:${googlePlaceId}` : '');
    if (!dataId) continue;
    const open = text(item.open_state);
    places.push({
      dataId,
      googlePlaceId,
      reviewWith: rawDataId ? { data_id: rawDataId } : googlePlaceId ? { place_id: googlePlaceId } : {},
      name,
      address: text(item.address),
      lat,
      lng,
      rating: num(item.rating),
      reviewsCount: num(item.reviews),
      priceLevel: priceLevel(item.price),
      openNow: open ? !/closed/i.test(open) : null,
      thumbnail: text(item.thumbnail),
      phone: text(item.phone),
      website: text(item.website),
      hours: weekHours(item.operating_hours),
    });
  }
  return places;
}

function weekHours(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const days = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return days.length ? Object.fromEntries(days.map(([day, hours]) => [day.toLowerCase(), hours])) : null;
}

function noResults(error: unknown) {
  return error instanceof HttpError && /hasn't returned any results/i.test(error.message);
}

async function maps(params: Query, signal?: AbortSignal) {
  try {
    const body = await callSerp({ ...params, json_restrictor: RESTRICTOR }, signal);
    if (Array.isArray(body.local_results)) return readPlaces(body);
  } catch (error) {
    if (noResults(error)) return [];
    console.error('[serp] restricted maps search failed', error instanceof Error ? error.message : error);
  }
  try {
    const body = await callSerp(params, signal);
    return readPlaces(body);
  } catch (error) {
    if (noResults(error)) return [];
    throw error;
  }
}

export function nearbyPlaces(lat: number, lng: number, signal?: AbortSignal) {
  return maps(
    {
      engine: 'google_maps',
      type: 'search',
      q: 'restaurants',
      lat,
      lon: lng,
      z: 14,
      nearby: true,
    },
    signal,
  );
}

export async function cravingPlaces(
  input: { q: string; lat: number; lng: number; radiusM: number; wantsBest: boolean; openNow?: boolean },
  signal?: AbortSignal,
) {
  return maps(
    {
      engine: 'google_maps',
      type: 'search',
      q: input.q,
      lat: input.lat,
      lon: input.lng,
      m: input.radiusM,
      nearby: true,
      ...(input.openNow === false ? {} : { open_state: 'now' }),
      ...(input.wantsBest ? { min_rating: '4.0' } : {}),
    },
    signal,
  );
}

export type WebHit = { title: string; link: string; snippet: string };

/** Google organic search (engine=google): local food blogs, news, "best X in Y" lists. */
export async function webSearch(q: string, signal?: AbortSignal): Promise<WebHit[]> {
  try {
    const body = await callSerp(
      { engine: 'google', q, num: 8, json_restrictor: 'organic_results[].{title,link,snippet}' },
      signal,
    );
    const rows = Array.isArray(body.organic_results) ? body.organic_results : [];
    return rows
      .map((row) => {
        const item = (row || {}) as Record<string, unknown>;
        return { title: text(item.title) || '', link: text(item.link) || '', snippet: text(item.snippet) || '' };
      })
      .filter((hit) => hit.title && hit.snippet)
      .slice(0, 8);
  } catch (error) {
    if (noResults(error)) return [];
    throw error;
  }
}

function reviewDate(review: Record<string, unknown>) {
  const iso = text(review.iso_date);
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const label = text(review.date) || '';
  if (/today/i.test(label)) return new Date();
  if (/yesterday/i.test(label)) return new Date(Date.now() - 86_400_000);
  const match = label.match(/(\d+)\s+(day|week|month|year)/i);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const days = unit.startsWith('day')
    ? count
    : unit.startsWith('week')
      ? count * 7
      : unit.startsWith('month')
        ? count * 30
        : count * 365;
  return new Date(Date.now() - days * 86_400_000);
}

export async function recentReviews(
  reviewWith: { data_id?: string; place_id?: string },
  signal?: AbortSignal,
): Promise<Review[]> {
  return (await reviewPages(reviewWith, signal)).reviews;
}

/**
 * Newest-first reviews from the last 3 months. Resumable: pass `startToken` from a previous
 * call's `nextToken` to read further pages without paying for the first page again.
 */
export async function reviewPages(
  reviewWith: { data_id?: string; place_id?: string },
  signal?: AbortSignal,
  options: { maxPages?: number; startToken?: string } = {},
): Promise<{ reviews: Review[]; nextToken: string | null; sawOld: boolean }> {
  if (!reviewWith.data_id && !reviewWith.place_id) return { reviews: [], nextToken: null, sawOld: false };
  const collected: Review[] = [];
  let token: string | undefined = options.startToken;
  let sawOld = false;
  for (let page = 0; page < (options.maxPages ?? 3); page += 1) {
    const body = await callSerp(
      {
        engine: 'google_maps_reviews',
        sort_by: 'newestFirst',
        ...reviewWith,
        ...(token ? { next_page_token: token } : {}),
      },
      signal,
    );
    const rows = Array.isArray(body.reviews) ? body.reviews : [];
    if (!rows.length) {
      token = undefined;
      break;
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const review = row as Record<string, unknown>;
      const published = reviewDate(review);
      if (!published) continue;
      if (Date.now() - published.getTime() > THREE_MONTHS_MS) {
        sawOld = true;
        continue;
      }
      const snippet =
        text(review.snippet) ||
        text((review.extracted_snippet as { original?: string } | undefined)?.original) ||
        '';
      if (!snippet) continue;
      const user = review.user as { name?: string; contributor_id?: string; thumbnail?: string; local_guide?: boolean; reviews?: number } | undefined;
      const author = text(user?.name);
      const contributorId = text(user?.contributor_id);
      const sourceId =
        text(review.review_id) ||
        `${author || 'guest'}:${published.toISOString()}:${snippet.slice(0, 40)}`;
      collected.push({
        sourceId,
        author,
        rating: num(review.rating),
        snippet: snippet.slice(0, 500),
        publishedAt: published.toISOString(),
        reviewer: contributorId
          ? { id: contributorId, name: author, photo: text(user?.thumbnail), localGuide: user?.local_guide === true, reviewCount: num(user?.reviews) }
          : null,
      });
    }
    const pagination = body.serpapi_pagination as { next_page_token?: string } | undefined;
    token = text(pagination?.next_page_token) || undefined;
    if (!token || sawOld) break;
  }
  return { reviews: collected, nextToken: sawOld ? null : token || null, sawOld };
}

export type ContributorReview = { place: string; type: string | null; rating: number | null; snippet: string };

/** What one reviewer has reviewed elsewhere (SerpApi engine=google_maps_contributor_reviews). */
export async function contributorReviews(contributorId: string, signal?: AbortSignal) {
  const body = await callSerp({ engine: 'google_maps_contributor_reviews', contributor_id: contributorId }, signal);
  const rows = Array.isArray(body.reviews) ? body.reviews : [];
  const reviews: ContributorReview[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const info = (item.place_info || {}) as { title?: unknown; type?: unknown };
    const place = text(info.title);
    if (!place) continue;
    reviews.push({ place, type: text(info.type), rating: num(item.rating), snippet: (text(item.snippet) || '').slice(0, 220) });
  }
  return reviews.slice(0, 20);
}

export type DrivingRoute = {
  distance: string | null;
  duration: string | null;
  path: { lat: number; lng: number }[];
};

function gpsPoint(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const point = value as { latitude?: unknown; longitude?: unknown };
  const lat = typeof point.latitude === 'number' ? point.latitude : Number(point.latitude);
  const lng = typeof point.longitude === 'number' ? point.longitude : Number(point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export async function drivingRoute(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<DrivingRoute> {
  const body = await callSerp(
    {
      engine: 'google_maps_directions',
      start_coords: `${start.lat},${start.lng}`,
      end_coords: `${end.lat},${end.lng}`,
      travel_mode: 0,
      distance_unit: 0,
    },
    signal,
  );
  const direction = Array.isArray(body.directions) ? (body.directions[0] as Record<string, unknown> | undefined) : undefined;
  if (!direction) throw new HttpError(404, 'No route found');
  const path = [start];
  const trips = Array.isArray(direction.trips) ? direction.trips : [];
  for (const trip of trips) {
    if (!trip || typeof trip !== 'object') continue;
    const details = (trip as { details?: unknown }).details;
    if (!Array.isArray(details)) continue;
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue;
      const point = gpsPoint((detail as { gps_coordinates?: unknown }).gps_coordinates);
      if (point) path.push(point);
    }
  }
  path.push(end);
  return {
    distance: typeof direction.formatted_distance === 'string' ? direction.formatted_distance : null,
    duration: typeof direction.formatted_duration === 'string' ? direction.formatted_duration : null,
    path,
  };
}
