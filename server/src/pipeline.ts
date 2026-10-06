import { dishQuery, fingerprint, geohash, haversine } from './geo.js';
import { embedTexts, overlayCopy, scoreWithGemini } from './gemini.js';
// Jev is paused because the API is paid. Uncomment the import and the blocks below to use it again.
// import { chooseFollowUp, scoreWithJev } from './jev.js';
import { fallbackPoints, preScore, sortPlaces } from './rank.js';
import { cravingPlaces, nearbyPlaces, recentReviews, type SerpPlace } from './serp.js';
import {
  readNearbyStore,
  readSearchStore,
  recordSearch,
  rememberNearby,
  rememberSearch,
  saveChunks,
  saveNearbySnapshot,
  savePlaces,
  saveSearchSnapshot,
} from './store.js';
import { assertHospitality } from './topic.js';
import { HttpError, type Actor, type Place } from './types.js';

const PREFS = new Set(['veg', 'spicy', 'family', 'quick bite']);
const ADDONS = new Set(['parking', 'outdoor seating', 'pure veg kitchen']);

export function cleanLists(preferences: unknown, addons: unknown) {
  const list = (value: unknown, allowed: Set<string>) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && allowed.has(item)) : [];
  return { preferences: list(preferences, PREFS), addons: list(addons, ADDONS) };
}

function toPlace(place: SerpPlace, distanceM: number | null): Place {
  return {
    id: place.dataId,
    dataId: place.dataId,
    googlePlaceId: place.googlePlaceId,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating,
    reviewsCount: place.reviewsCount,
    priceLevel: place.priceLevel,
    openNow: place.openNow,
    thumbnail: place.thumbnail,
    phone: place.phone,
    website: place.website,
    distanceM,
    reviews: [],
    points: null,
    verdict: null,
    evidence: [],
  };
}

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function reviewsFromLastThreeMonths(reviews: Place['reviews']) {
  const cutoff = Date.now() - THREE_MONTHS_MS;
  return reviews.filter((review) => {
    const published = new Date(review.publishedAt).getTime();
    return Number.isFinite(published) && published >= cutoff;
  });
}

function reviewTone(rating: number | null) {
  if (rating == null) return null;
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

export function present(place: Place) {
  const reviews = reviewsFromLastThreeMonths(place.reviews);
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const review of reviews) {
    const tone = reviewTone(review.rating);
    if (tone) sentiment[tone] += 1;
  }
  const latest = [...reviews].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating,
    reviewsCount: place.reviewsCount,
    priceLevel: place.priceLevel,
    openNow: place.openNow,
    thumbnail: place.thumbnail,
    phone: place.phone,
    website: place.website,
    distanceM: place.distanceM == null ? null : Math.round(place.distanceM),
    points: place.points,
    verdict: place.verdict,
    evidence: place.evidence,
    sentiment,
    latestReview: latest
      ? { author: latest.author, rating: latest.rating, snippet: latest.snippet, publishedAt: latest.publishedAt }
      : null,
    reviews: reviews.slice(0, 8).map((review) => ({
      author: review.author,
      rating: review.rating,
      snippet: review.snippet,
      publishedAt: review.publishedAt,
    })),
  };
}

export async function findNearby(actor: Actor, lat: number, lng: number) {
  const hash = geohash(lat, lng, 6);
  const cached = await readNearbyStore(actor, hash);
  if (cached) {
    return {
      cacheHit: true,
      places: cached.map((place) => present({ ...place, distanceM: haversine(lat, lng, place.lat, place.lng) })),
    };
  }
  const found = await nearbyPlaces(lat, lng, AbortSignal.timeout(15000));
  const places = found.map((place) => toPlace(place, haversine(lat, lng, place.lat, place.lng)));
  const saved = await savePlaces(actor, places);
  rememberNearby(hash, saved);
  await saveNearbySnapshot(actor, hash, saved.map((place) => place.id));
  return { cacheHit: false, places: saved.map(present) };
}

async function embedLater(actor: Actor, places: Place[]) {
  const rows = places.flatMap((place) =>
    place.reviews.slice(0, 6).map((review) => ({
      placeId: place.id,
      content: review.snippet,
      publishedAt: review.publishedAt,
    })),
  );
  if (!rows.length) return;
  const vectors = await embedTexts(rows.map((row) => row.content));
  await saveChunks(
    actor,
    rows.map((row, index) => ({ ...row, embedding: vectors[index] })),
  );
}

export async function findFood(
  actor: Actor,
  input: {
    craving: string;
    lat: number;
    lng: number;
    radiusM: number;
    preferences: string[];
    addons: string[];
  },
) {
  await assertHospitality(input.craving, 'search');
  const dish = dishQuery(input.craving);
  if (!dish) throw new HttpError(400, 'Say what you want to eat');
  const wantsBest = /\bbest\b|highly rated/i.test(input.craving);
  const key = fingerprint({ ...input, craving: input.craving, wantsBest });
  const cached = await readSearchStore(actor, key);
  if (cached) {
    await recordSearch(actor, {
      query: input.craving,
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      budget: 'any',
      preferences: input.preferences,
      addons: input.addons,
      placeIds: cached.places.map((place) => place.id),
      cacheHit: true,
    });
    return { cacheHit: true, fingerprint: key, headline: cached.headline, reason: cached.reason, places: cached.places.map(present) };
  }

  const found = await cravingPlaces(
    { q: dish, lat: input.lat, lng: input.lng, radiusM: input.radiusM, wantsBest },
    AbortSignal.timeout(15000),
  );
  const nearby = found
    .map((place) => ({ serp: place, place: toPlace(place, haversine(input.lat, input.lng, place.lat, place.lng)) }))
    .filter((item) => (item.place.distanceM ?? Infinity) <= input.radiusM)
    .sort(
      (a, b) =>
        preScore(
          { distanceM: b.place.distanceM ?? input.radiusM, rating: b.place.rating },
          input.radiusM,
        ) -
        preScore(
          { distanceM: a.place.distanceM ?? input.radiusM, rating: a.place.rating },
          input.radiusM,
        ),
    )
    .slice(0, 5);

  const enriched = await Promise.all(
    nearby.map(async (item) => {
      try {
        const reviews = await recentReviews(item.serp.reviewWith, AbortSignal.timeout(20000));
        return {
          ...item.place,
          reviews,
          evidence: reviews.slice(0, 3).map((review) => ({ text: review.snippet, publishedAt: review.publishedAt })),
        };
      } catch (error) {
        console.error('[serp] reviews failed', item.place.name, error instanceof Error ? error.message : error);
        return item.place;
      }
    }),
  );

  // let jevPoints: Awaited<ReturnType<typeof scoreWithJev>> = null;
  // try {
  //   jevPoints = await scoreWithJev(enriched, { ...input, craving: dish });
  // } catch (error) {
  //   console.error('[jev]', error instanceof Error ? error.message : error);
  // }
  let judged: Awaited<ReturnType<typeof scoreWithGemini>> = null;
  try {
    judged = await scoreWithGemini(enriched, {
      craving: dish,
      radiusM: input.radiusM,
      preferences: input.preferences,
      addons: input.addons,
    });
  } catch (error) {
    console.error('[gemini]', error instanceof Error ? error.message : error);
  }
  const scored = enriched.map((place) => {
    const row = judged?.byId.get(place.id);
    return {
      ...place,
      points: row?.points || fallbackPoints(place, input.radiusM),
      verdict: row?.verdict ?? null,
    };
  });
  const ordered = sortPlaces(scored);
  const saved = await savePlaces(actor, ordered);
  const ranked = saved.map((place) => ({
    ...place,
    verdict: place.verdict ?? (place.points?.source === 'fallback' ? 'Ranked from rating and distance.' : null),
  }));
  const snapshot = {
    fingerprint: key,
    headline: judged?.headline || (ranked.length ? 'Review report' : 'No open match'),
    reason:
      judged?.reason ||
      (ranked.length ? 'Built from reviews in the last 3 months.' : 'Try a wider radius.'),
    places: ranked,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  rememberSearch(snapshot);
  await saveSearchSnapshot(actor, snapshot);
  await recordSearch(actor, {
    query: input.craving,
    lat: input.lat,
    lng: input.lng,
    radiusM: input.radiusM,
    budget: 'any',
    preferences: input.preferences,
    addons: input.addons,
    placeIds: ranked.map((place) => place.id),
    cacheHit: false,
  });
  void Promise.race([
    embedLater(actor, ranked).catch((error) => console.error('[embed]', error instanceof Error ? error.message : error)),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
  return { cacheHit: false, fingerprint: key, headline: snapshot.headline, reason: snapshot.reason, places: ranked.map(present) };
}

function retrieve(places: Place[], question: string) {
  const query = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const rows = places.flatMap((place) =>
    place.reviews.map((review) => {
      const words = new Set(`${place.name} ${review.snippet}`.toLowerCase().split(/[^a-z0-9]+/));
      let score = 0;
      for (const word of query) if (words.has(word)) score += 1;
      return { placeId: place.id, score };
    }),
  );
  return rows.filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
}

export async function askFollowUp(actor: Actor, fingerprintKey: string, question: string) {
  await assertHospitality(question, 'followup');
  const snapshot = await readSearchStore(actor, fingerprintKey);
  if (!snapshot) throw new HttpError(404, 'Search again to refresh these places');
  const hits = retrieve(snapshot.places, question);
  if (!hits.length) {
    return {
      headline: 'Nothing in the reviews',
      reason: 'These recent reviews do not answer that.',
      placeId: null as string | null,
      verdict: null as string | null,
    };
  }
  // let placeId: string | null = await chooseFollowUp(snapshot.places, question);
  let copy: Awaited<ReturnType<typeof overlayCopy>> = null;
  try {
    copy = await overlayCopy(snapshot.places, { question, mode: 'followup' });
  } catch (error) {
    console.error('[gemini]', error instanceof Error ? error.message : error);
  }
  const placeId =
    copy?.places.find((place) => snapshot.places.some((item) => item.id === place.placeId))?.placeId ||
    hits[0]?.placeId ||
    null;
  const verdict = copy?.places.find((place) => place.placeId === placeId)?.verdict || copy?.places[0]?.verdict || null;
  return {
    headline: copy?.headline || 'From the saved reviews',
    reason: copy?.reason || 'Answered from the reviews already stored.',
    placeId,
    verdict,
  };
}
