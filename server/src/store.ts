import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import type { Actor, Place, Review, Snapshot } from './types.js';

const nearbyMem = new Map<string, { expires: number; places: Place[] }>();
const searchMem = new Map<string, Snapshot>();

let admin: SupabaseClient | null = null;

function clientFor(jwt: string) {
  if (!env.supabaseUrl || !env.supabaseKey) return null;
  if (env.serviceRole) {
    admin ||= createClient(env.supabaseUrl, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return admin;
  }
  return createClient(env.supabaseUrl, env.supabaseKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function authClient() {
  if (!env.supabaseUrl || !env.supabaseKey) return null;
  return createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function log(scope: string, error: { message: string } | null) {
  if (error) console.error(`[supabase] ${scope}: ${error.message}`);
}

export function readNearbyMemory(geohash: string) {
  const hit = nearbyMem.get(geohash);
  if (!hit || hit.expires < Date.now()) return null;
  return hit.places;
}

export function readSearchMemory(fingerprint: string) {
  const hit = searchMem.get(fingerprint);
  if (!hit || hit.expiresAt < Date.now()) return null;
  return hit;
}

export function rememberNearby(geohash: string, places: Place[]) {
  nearbyMem.set(geohash, { expires: Date.now() + 2 * 60 * 60 * 1000, places });
}

export function rememberSearch(snapshot: Snapshot) {
  searchMem.set(snapshot.fingerprint, snapshot);
}

function placeFromRow(row: Record<string, unknown>, reviews: Review[] = []): Place {
  return {
    id: String(row.id),
    dataId: String(row.data_id),
    googlePlaceId: (row.google_place_id as string | null) ?? null,
    name: String(row.name),
    address: (row.address as string | null) ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    rating: row.rating == null ? null : Number(row.rating),
    reviewsCount: row.reviews_count == null ? null : Number(row.reviews_count),
    priceLevel: row.price_level == null ? null : Number(row.price_level),
    openNow: (row.open_now as boolean | null) ?? null,
    thumbnail: (row.thumbnail as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    distanceM: null,
    reviews,
    points: null,
    verdict: null,
    evidence: reviews.slice(0, 3).map((review) => ({ text: review.snippet, publishedAt: review.publishedAt })),
  };
}

export async function savePlaces(actor: Actor, places: Place[]) {
  const db = clientFor(actor.jwt);
  if (!db) return places;
  const saved: Place[] = [];
  for (const place of places) {
    const { data, error } = await db
      .from('places')
      .upsert(
        {
          data_id: place.dataId,
          google_place_id: place.googlePlaceId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating,
          reviews_count: place.reviewsCount,
          price_level: place.priceLevel,
          open_now: place.openNow,
          thumbnail: place.thumbnail,
          phone: place.phone,
          website: place.website,
          fetched_at: new Date().toISOString(),
          static_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          ...(place.reviews.length ? { reviews_cached_at: new Date().toISOString() } : {}),
        },
        { onConflict: 'data_id' },
      )
      .select('id')
      .single();
    log('places', error);
    const id = data?.id ? String(data.id) : place.id;
    const next = { ...place, id };
    if (data?.id && place.reviews.length) {
      const { error: reviewError } = await db.from('place_reviews').upsert(
        place.reviews.map((review) => ({
          place_id: id,
          source_review_id: review.sourceId,
          author: review.author,
          rating: review.rating,
          snippet: review.snippet,
          published_at: review.publishedAt,
        })),
        { onConflict: 'place_id,source_review_id' },
      );
      log('reviews', reviewError);
    }
    saved.push(next);
  }
  return saved;
}

export async function saveReviewsCache(actor: Actor, placeId: string, reviews: Review[]) {
  const db = clientFor(actor.jwt);
  if (!db || !reviews.length) return;
  const { error } = await db.from('place_reviews').upsert(
    reviews.map((review) => ({
      place_id: placeId,
      source_review_id: review.sourceId,
      author: review.author,
      rating: review.rating,
      snippet: review.snippet,
      published_at: review.publishedAt,
    })),
    { onConflict: 'place_id,source_review_id' },
  );
  log('reviews', error);
  await db.from('places').update({ reviews_cached_at: new Date().toISOString() }).eq('id', placeId);
}

export async function saveChunks(
  actor: Actor,
  rows: { placeId: string; content: string; embedding: number[] | null; publishedAt: string }[],
) {
  const db = clientFor(actor.jwt);
  if (!db || !rows.length) return;
  const placeIds = [...new Set(rows.map((row) => row.placeId))];
  const { error: deleteError } = await db.from('review_chunks').delete().in('place_id', placeIds);
  log('chunks.delete', deleteError);
  const { error } = await db.from('review_chunks').insert(
    rows.map((row) => ({
      place_id: row.placeId,
      content: row.content,
      embedding: row.embedding ? `[${row.embedding.join(',')}]` : null,
      metadata: { publishedAt: row.publishedAt },
    })),
  );
  log('chunks', error);
}

export async function saveNearbySnapshot(actor: Actor, geohash: string, placeIds: string[]) {
  const db = clientFor(actor.jwt);
  if (!db) return;
  const { error } = await db.from('nearby_snapshots').upsert({
    geohash,
    place_ids: placeIds,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  log('nearby', error);
}

export async function saveSearchSnapshot(actor: Actor, snapshot: Snapshot) {
  const db = clientFor(actor.jwt);
  if (!db) return;
  const { error } = await db.from('search_snapshots').upsert({
    fingerprint: snapshot.fingerprint,
    place_ids: snapshot.places.map((place) => place.id),
    score_json: {
      headline: snapshot.headline,
      reason: snapshot.reason,
      places: snapshot.places.map((place) => ({
        id: place.id,
        points: place.points,
        verdict: place.verdict,
        evidence: place.evidence,
        distanceM: place.distanceM,
      })),
    },
    expires_at: new Date(snapshot.expiresAt).toISOString(),
  });
  log('search', error);
}

async function loadPlaces(db: SupabaseClient, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await db.from('places').select('*').in('id', ids);
  log('load places', error);
  const { data: reviews, error: reviewError } = await db
    .from('place_reviews')
    .select('place_id, source_review_id, author, rating, snippet, published_at')
    .in('place_id', ids);
  log('load reviews', reviewError);
  const byPlace = new Map<string, Review[]>();
  for (const review of reviews || []) {
    const list = byPlace.get(review.place_id) || [];
    list.push({
      sourceId: review.source_review_id,
      author: review.author,
      rating: review.rating == null ? null : Number(review.rating),
      snippet: review.snippet,
      publishedAt: review.published_at,
    });
    byPlace.set(review.place_id, list);
  }
  const map = new Map((data || []).map((row) => [row.id as string, placeFromRow(row, byPlace.get(row.id) || [])]));
  return ids.map((id) => map.get(id)).filter((place): place is Place => Boolean(place));
}

export async function readNearbyStore(actor: Actor, geohash: string) {
  const memory = readNearbyMemory(geohash);
  if (memory) return memory;
  const db = clientFor(actor.jwt);
  if (!db) return null;
  const { data, error } = await db.from('nearby_snapshots').select('place_ids, expires_at').eq('geohash', geohash).maybeSingle();
  log('nearby read', error);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const places = await loadPlaces(db, data.place_ids || []);
  rememberNearby(geohash, places);
  return places;
}

export async function readSearchStore(actor: Actor, fingerprint: string) {
  const memory = readSearchMemory(fingerprint);
  if (memory) return memory;
  const db = clientFor(actor.jwt);
  if (!db) return null;
  const { data, error } = await db
    .from('search_snapshots')
    .select('place_ids, score_json, expires_at')
    .eq('fingerprint', fingerprint)
    .maybeSingle();
  log('search read', error);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const places = await loadPlaces(db, data.place_ids || []);
  const score = data.score_json as {
    headline?: string;
    reason?: string;
    places?: { id: string; points: Place['points']; verdict: string | null; evidence: Place['evidence']; distanceM: number | null }[];
  };
  const meta = new Map((score.places || []).map((place) => [place.id, place]));
  for (const place of places) {
    const row = meta.get(place.id);
    if (!row) continue;
    place.points = row.points;
    place.verdict = row.verdict;
    place.evidence = row.evidence || place.evidence;
    place.distanceM = row.distanceM;
  }
  const snapshot: Snapshot = {
    fingerprint,
    headline: score.headline || 'Ranked near you',
    reason: score.reason || 'Loaded from the saved search.',
    places,
    expiresAt: new Date(data.expires_at).getTime(),
  };
  rememberSearch(snapshot);
  return snapshot;
}

export async function recordSearch(
  actor: Actor,
  input: {
    query: string;
    lat: number;
    lng: number;
    radiusM: number;
    budget: string;
    preferences: string[];
    addons: string[];
    placeIds: string[];
    cacheHit: boolean;
  },
) {
  const db = clientFor(actor.jwt);
  if (!db) return;
  const { error } = await db.from('searches').insert({
    user_id: actor.userId,
    query_text: input.query,
    lat: input.lat,
    lng: input.lng,
    radius_m: input.radiusM,
    budget: input.budget,
    preferences: input.preferences,
    addons: input.addons,
    result_place_ids: input.placeIds,
    cache_hit: input.cacheHit,
  });
  log('searches', error);
}

export async function recordVisit(actor: Actor, placeId: string) {
  const db = clientFor(actor.jwt);
  if (!db) return false;
  const { error } = await db.from('place_visits').insert({
    user_id: actor.userId,
    place_id: placeId,
    visited_at: new Date().toISOString(),
  });
  log('visits', error);
  return !error;
}
