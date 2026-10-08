import { toolTurn, type Content, type FunctionDeclaration, type Part } from './gemini.js';
import { dishQuery, fingerprint, haversine } from './geo.js';
import { embedLater, present } from './pipeline.js';
import { fallbackPoints } from './rank.js';
import { cravingPlaces, drivingRoute, reviewPages, webSearch, type SerpPlace } from './serp.js';
import { readSearchStore, recordSearch, rememberSearch, savePlaces, saveSearchSnapshot } from './store.js';
import { assertHospitality } from './topic.js';
import { HttpError, type Actor, type Place, type Review, type TraceStep } from './types.js';

/*
 * YumAI as an agent. Gemini decides which SerpApi engines to call and when:
 *   search_places   -> engine=google_maps          (can change radius / open-now / min rating itself)
 *   read_reviews    -> engine=google_maps_reviews  (newest first, can page deeper for one place)
 *   web_search      -> engine=google               (local food blogs, "best X in Y" lists)
 *   get_directions  -> engine=google_maps_directions
 *   finish          -> the ranked answer, with a verdict per place drawn only from what it read
 * Every tool call carries a `why` sentence that the map shows live as the agent works.
 */

export type AgentEvent =
  | { type: 'step'; id: number; tool: string; say: string; status: 'running' }
  | { type: 'step'; id: number; tool: string; say: string; status: 'done'; summary: string }
  | { type: 'places'; places: ReturnType<typeof present>[] }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

export type Emit = (event: AgentEvent) => void;

type Candidate = {
  key: string;
  serp: SerpPlace | null;
  place: Place;
  nextToken: string | null;
  reviewsRead: boolean;
  route: { distance: string | null; duration: string | null } | null;
  webMentions: string[];
};

type State = {
  actor: Actor;
  user: { lat: number; lng: number };
  radiusM: number;
  dish: string;
  candidates: Map<string, Candidate>;
  serpCalls: number;
  serpCap: number;
  stepId: number;
  trace: TraceStep[];
  emit: Emit;
};

const MAX_TURNS = 10;

function clamp(value: unknown, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}

function distLabel(meters: number | null) {
  if (meters == null) return 'unknown distance';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function toPlace(serp: SerpPlace, user: { lat: number; lng: number }): Place {
  return {
    id: serp.dataId,
    dataId: serp.dataId,
    googlePlaceId: serp.googlePlaceId,
    name: serp.name,
    address: serp.address,
    lat: serp.lat,
    lng: serp.lng,
    rating: serp.rating,
    reviewsCount: serp.reviewsCount,
    priceLevel: serp.priceLevel,
    openNow: serp.openNow,
    thumbnail: serp.thumbnail,
    phone: serp.phone,
    website: serp.website,
    distanceM: haversine(user.lat, user.lng, serp.lat, serp.lng),
    reviews: [],
    points: null,
    verdict: null,
    evidence: [],
  };
}

function reviewWithFor(candidate: Candidate) {
  if (candidate.serp) return candidate.serp.reviewWith;
  const dataId = candidate.place.dataId;
  return dataId.startsWith('pid:') ? { place_id: dataId.slice(4) } : { data_id: dataId };
}

function briefPlace(candidate: Candidate) {
  const place = candidate.place;
  return {
    place_id: candidate.key,
    name: place.name,
    rating: place.rating,
    review_count: place.reviewsCount,
    price_level: place.priceLevel,
    distance: distLabel(place.distanceM),
    open_now: place.openNow,
    reviews_read: candidate.reviewsRead ? place.reviews.length : 0,
  };
}

function briefReviews(reviews: Review[]) {
  return reviews.slice(0, 12).map((review) => ({
    date: review.publishedAt.slice(0, 10),
    rating: review.rating,
    text: review.snippet.slice(0, 280),
  }));
}

// ---- Tool declarations -----------------------------------------------------------------------

const WHY = {
  type: 'STRING',
  description: 'One short present-tense sentence shown to the user, e.g. "Searching Google Maps for chicken biryani within 2 km".',
};

const SEARCH_TOOLS: FunctionDeclaration[] = [
  {
    name: 'search_places',
    description:
      'Search Google Maps (SerpApi engine=google_maps) around the user. Returns open restaurants with rating, price, distance. Change radius_m or the query to widen or refine. Results outside radius_m are dropped.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Dish, cuisine or venue type, e.g. "chicken biryani" or "mandi".' },
        radius_m: { type: 'INTEGER', description: 'One of 1000, 2000, 5000, 10000.' },
        open_now: { type: 'BOOLEAN', description: 'Only places open right now. Default true.' },
        min_rating: { type: 'NUMBER', description: 'Optional minimum Google rating, e.g. 4.0.' },
        why: WHY,
      },
      required: ['query', 'radius_m', 'why'],
    },
  },
  {
    name: 'read_reviews',
    description:
      'Read the newest Google reviews from the last 3 months (SerpApi engine=google_maps_reviews). Pass several place_ids at once; they are fetched in parallel. Call with more=true to read the next page for places whose reviews did not mention the dish yet.',
    parameters: {
      type: 'OBJECT',
      properties: {
        place_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'place_ids returned by search_places. Usually 3 to 5 at once.' },
        more: { type: 'BOOLEAN', description: 'Read the next page instead of the first.' },
        why: WHY,
      },
      required: ['place_ids', 'why'],
    },
  },
  {
    name: 'web_search',
    description:
      'Google web search (SerpApi engine=google). Use to cross-check candidates against local food blogs, news and "best X in <area>" lists, or to find the local name of a dish.',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING' }, why: WHY },
      required: ['query', 'why'],
    },
  },
  {
    name: 'get_directions',
    description: 'Driving time and distance from the user to one place (SerpApi engine=google_maps_directions). Use when the user cares about speed or closeness.',
    parameters: {
      type: 'OBJECT',
      properties: { place_id: { type: 'STRING' }, why: WHY },
      required: ['place_id', 'why'],
    },
  },
  {
    name: 'finish',
    description: 'Return the final ranked answer. Only include places whose reviews you read. Rank 1 is best.',
    parameters: {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING', description: 'Max 8 words. States the finding, e.g. "Two spots reviewers trust for biryani".' },
        reason: { type: 'STRING', description: 'Max 24 words. What the recent reviews actually say, and what you checked.' },
        ranked: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              place_id: { type: 'STRING' },
              verdict: { type: 'STRING', description: 'Max 22 words, from the reviews you read. If they do not mention the dish, say so.' },
              review_support: { type: 'INTEGER', description: '0-30. How strongly recent reviews support the craving and preferences.' },
            },
            required: ['place_id', 'verdict', 'review_support'],
          },
        },
      },
      required: ['headline', 'reason', 'ranked'],
    },
  },
];

const FOLLOWUP_TOOLS: FunctionDeclaration[] = [
  SEARCH_TOOLS[1],
  SEARCH_TOOLS[2],
  SEARCH_TOOLS[3],
  {
    name: 'finish_answer',
    description: 'Answer the follow-up from the evidence gathered. Point at one place when the question asks for a pick.',
    parameters: {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING', description: 'Max 8 words.' },
        reason: { type: 'STRING', description: 'Max 24 words. The evidence, not a formula.' },
        place_id: { type: 'STRING', description: 'The chosen place_id, or omit when no single place answers it.' },
        verdict: { type: 'STRING', description: 'Max 22 words about the chosen place. Omit when place_id is omitted.' },
      },
      required: ['headline', 'reason'],
    },
  },
];

// ---- Tool execution ---------------------------------------------------------------------------

function step(state: State, tool: string, say: string) {
  const id = ++state.stepId;
  state.emit({ type: 'step', id, tool, say, status: 'running' });
  return (summary: string) => {
    state.trace.push({ tool, say, summary });
    state.emit({ type: 'step', id, tool, say, status: 'done', summary });
  };
}

function spend(state: State) {
  if (state.serpCalls >= state.serpCap) return false;
  state.serpCalls += 1;
  return true;
}

const BUDGET_GONE = { error: 'SerpApi budget for this search is used up. Call finish now with the evidence you already have.' };

function emitPlaces(state: State) {
  const places = [...state.candidates.values()].map((candidate) => present(candidate.place));
  state.emit({ type: 'places', places });
}

async function execSearch(state: State, args: Record<string, unknown>) {
  const query = String(args.query || state.dish).trim() || state.dish;
  const radiusM = [1000, 2000, 5000, 10000].includes(Number(args.radius_m)) ? Number(args.radius_m) : state.radiusM;
  const done = step(state, 'search_places', String(args.why || `Searching Google Maps for ${query}`));
  if (!spend(state)) {
    done('Skipped: budget used up');
    return BUDGET_GONE;
  }
  let found: SerpPlace[] = [];
  try {
    found = await cravingPlaces(
      {
        q: query,
        lat: state.user.lat,
        lng: state.user.lng,
        radiusM,
        wantsBest: Number(args.min_rating) >= 4,
        openNow: args.open_now !== false,
      },
      AbortSignal.timeout(15000),
    );
  } catch (error) {
    done('Google Maps search failed');
    return { error: error instanceof Error ? error.message : 'search failed' };
  }
  state.radiusM = Math.max(state.radiusM, radiusM);
  const fresh: Candidate[] = [];
  for (const serp of found) {
    const place = toPlace(serp, state.user);
    if ((place.distanceM ?? Infinity) > radiusM) continue;
    const existing = [...state.candidates.values()].find((candidate) => candidate.place.dataId === serp.dataId);
    if (existing) continue;
    const key = `p${state.candidates.size + 1}`;
    const candidate: Candidate = { key, serp, place, nextToken: null, reviewsRead: false, route: null, webMentions: [] };
    state.candidates.set(key, candidate);
    fresh.push(candidate);
  }
  const inRadius = [...state.candidates.values()].filter((candidate) => (candidate.place.distanceM ?? Infinity) <= radiusM);
  done(`${found.length} results, ${inRadius.length} within ${distLabel(radiusM)}${fresh.length ? `, ${fresh.length} new` : ''}`);
  if (fresh.length) emitPlaces(state);
  return {
    query,
    radius_m: radiusM,
    new_places: fresh.length,
    places: inRadius.sort((a, b) => (a.place.distanceM ?? 0) - (b.place.distanceM ?? 0)).map(briefPlace),
  };
}

/** "biryani" ~ "biriyani" ~ "biriyaani": compare words by consonant skeleton so local spellings count as a mention. */
function skeleton(word: string) {
  return word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function mentionsDish(text: string, dish: string) {
  const wanted = dish.split(/\s+/).filter((word) => word.length >= 4).map(skeleton).filter(Boolean);
  if (!wanted.length) return false;
  const words = new Set(text.split(/[^A-Za-z]+/).map(skeleton).filter(Boolean));
  return wanted.some((want) => words.has(want));
}

async function readOne(state: State, candidate: Candidate, more: boolean) {
  if (more && !candidate.nextToken) {
    return { place_id: candidate.key, name: candidate.place.name, reviews: [], note: 'No more reviews from the last 3 months.', added: 0 };
  }
  if (!more && candidate.reviewsRead) {
    return { place_id: candidate.key, name: candidate.place.name, reviews: briefReviews(candidate.place.reviews), note: 'Already read; shown again.', added: 0 };
  }
  if (!spend(state)) return { place_id: candidate.key, name: candidate.place.name, ...BUDGET_GONE, added: 0 };
  try {
    const result = await reviewPages(reviewWithFor(candidate), AbortSignal.timeout(20000), {
      maxPages: 1,
      startToken: more ? candidate.nextToken || undefined : undefined,
    });
    const seen = new Set(candidate.place.reviews.map((review) => review.sourceId));
    const added = result.reviews.filter((review) => !seen.has(review.sourceId));
    candidate.place.reviews = [...candidate.place.reviews, ...added];
    candidate.place.evidence = candidate.place.reviews.slice(0, 3).map((review) => ({ text: review.snippet, publishedAt: review.publishedAt }));
    candidate.nextToken = result.nextToken;
    candidate.reviewsRead = true;
    return {
      place_id: candidate.key,
      name: candidate.place.name,
      reviews: briefReviews(added),
      more_available: Boolean(result.nextToken),
      added: added.length,
    };
  } catch (error) {
    return { place_id: candidate.key, name: candidate.place.name, error: error instanceof Error ? error.message : 'reviews failed', added: 0 };
  }
}

async function execReviews(state: State, args: Record<string, unknown>) {
  const ids = Array.isArray(args.place_ids) ? args.place_ids.map(String) : args.place_id ? [String(args.place_id)] : [];
  const picked = ids.map((id) => state.candidates.get(id)).filter((candidate): candidate is Candidate => Boolean(candidate)).slice(0, 6);
  if (!picked.length) return { error: 'No known place_ids given. Use ids from search_places.' };
  const more = args.more === true;
  const names = picked.map((candidate) => candidate.place.name);
  const label = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  const done = step(state, 'read_reviews', String(args.why || `Reading recent Google reviews for ${label}`));
  const results = await Promise.all(picked.map((candidate) => readOne(state, candidate, more && candidate.reviewsRead)));
  const added = results.reduce((sum, row) => sum + row.added, 0);
  const mentioning = picked.filter((candidate) => candidate.place.reviews.some((review) => mentionsDish(review.snippet, state.dish))).length;
  const where = picked.length === 1 ? picked[0].place.name : `${picked.length} places`;
  done(state.dish ? `${added} recent reviews across ${where}; ${mentioning} mention the dish` : `${added} more recent reviews for ${where}`);
  return { places: results.map(({ added: _added, ...row }) => row) };
}

async function execWeb(state: State, args: Record<string, unknown>) {
  const query = String(args.query || '').trim();
  if (!query) return { error: 'query is required' };
  const done = step(state, 'web_search', String(args.why || `Searching the web for ${query}`));
  if (!spend(state)) {
    done('Skipped: budget used up');
    return BUDGET_GONE;
  }
  try {
    const hits = await webSearch(query, AbortSignal.timeout(20000));
    for (const candidate of state.candidates.values()) {
      const name = candidate.place.name.toLowerCase();
      for (const hit of hits) {
        if (`${hit.title} ${hit.snippet}`.toLowerCase().includes(name)) candidate.webMentions.push(hit.title);
      }
    }
    const mentioned = [...state.candidates.values()].filter((candidate) => candidate.webMentions.length).map((candidate) => candidate.key);
    done(`${hits.length} results${mentioned.length ? `, mentions ${mentioned.length} of your candidates` : ''}`);
    return {
      results: hits.map((hit) => ({ title: hit.title, snippet: hit.snippet })),
      candidates_mentioned: mentioned,
    };
  } catch (error) {
    done('Web search failed');
    return { error: error instanceof Error ? error.message : 'web search failed' };
  }
}

async function execDirections(state: State, args: Record<string, unknown>) {
  const candidate = state.candidates.get(String(args.place_id));
  if (!candidate) return { error: `Unknown place_id ${String(args.place_id)}` };
  const done = step(state, 'get_directions', String(args.why || `Checking the drive to ${candidate.place.name}`));
  if (candidate.route) {
    done(`${candidate.route.duration || '?'} · ${candidate.route.distance || '?'}`);
    return { place_id: candidate.key, ...candidate.route };
  }
  if (!spend(state)) {
    done('Skipped: budget used up');
    return BUDGET_GONE;
  }
  try {
    const route = await drivingRoute(state.user, { lat: candidate.place.lat, lng: candidate.place.lng }, AbortSignal.timeout(12000));
    candidate.route = { distance: route.distance, duration: route.duration };
    done(`${route.duration || '?'} drive · ${route.distance || '?'}`);
    return { place_id: candidate.key, duration: route.duration, distance: route.distance };
  } catch (error) {
    done('Directions unavailable');
    return { error: error instanceof Error ? error.message : 'directions failed' };
  }
}

async function execTool(state: State, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search_places':
      return execSearch(state, args);
    case 'read_reviews':
      return execReviews(state, args);
    case 'web_search':
      return execWeb(state, args);
    case 'get_directions':
      return execDirections(state, args);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// ---- The loop ---------------------------------------------------------------------------------

type Finish = Record<string, unknown> | null;

/** Runs model turns until the model calls `finishTool`. Returns its args, or null when the model gave up. */
async function runLoop(state: State, system: string, task: string, tools: FunctionDeclaration[], finishTool: string): Promise<Finish> {
  const contents: Content[] = [{ role: 'user', parts: [{ text: task }] }];
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const model = await toolTurn(system, contents, tools);
    if (!model) return null;
    contents.push(model);
    const calls = model.parts.filter((part): part is Extract<Part, { functionCall: unknown }> => 'functionCall' in part);
    if (!calls.length) {
      contents.push({ role: 'user', parts: [{ text: `Use a tool, or call ${finishTool} with what you have.` }] });
      continue;
    }
    const responses: Part[] = [];
    for (const call of calls) {
      const { name, args } = call.functionCall;
      if (name === finishTool) return args || {};
      const response = await execTool(state, name, args || {});
      responses.push({ functionResponse: { name, response } });
    }
    contents.push({ role: 'user', parts: responses });
    if (turn === MAX_TURNS - 2) {
      contents.push({ role: 'user', parts: [{ text: `This is your last step. Call ${finishTool} now.` }] });
    }
  }
  return null;
}

// ---- Search -----------------------------------------------------------------------------------

const SEARCH_SYSTEM = `You are YumAI, the food-finding agent inside YumFindAI. You find the best open places for one craving by calling SerpApi tools yourself, then rank them from evidence you actually read.

How to work:
1. Start with search_places using the user's craving and radius.
2. Read reviews for the 3 to 5 most promising places (closest, best rated, open) in ONE read_reviews call with several place_ids. Prefer places whose recent reviews mention the dish.
3. If fewer than 3 places are found, or reviews do not support the dish, widen the radius (2 km -> 5 km -> 10 km) or try the local name of the dish. One web_search for "best <dish> in <area>" is a good cross-check when candidates are many.
4. Use read_reviews with more=true (several place_ids at once) when first pages never mention the dish.
5. Use get_directions only if the user asked for quick, close, or walking distance.
6. Call finish with 3 to 5 places (fewer only if that is all that exists). Only rank places whose reviews you read.

Rules:
- Never invent a restaurant, rating, price, distance or review. Verdicts quote what reviews from the last 3 months say. If they do not mention the dish, say that plainly.
- Respect the user's preferences and add-ons; look for them in reviews (veg, spicy, family, parking, outdoor seating, pure veg).
- Each tool call must include a short, specific "why" sentence for the user. Mention the engine in plain words: Google Maps, Google reviews, the web, directions.
- Be efficient: you have a SerpApi budget of about 12 calls. Do not re-read reviews you already have.`;

export async function runSearchAgent(
  actor: Actor,
  input: { craving: string; lat: number; lng: number; radiusM: number; preferences: string[]; addons: string[]; locationLabel?: string },
  emit: Emit,
) {
  await assertHospitality(input.craving, 'search');
  const dish = dishQuery(input.craving);
  if (!dish) throw new HttpError(400, 'Say what you want to eat');
  const wantsBest = /\bbest\b|highly rated/i.test(input.craving);
  const key = fingerprint({ ...input, wantsBest });

  const cached = await readSearchStore(actor, key);
  if (cached) {
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Loading this search from memory', status: 'running' });
    await recordSearch(actor, { query: input.craving, lat: input.lat, lng: input.lng, radiusM: input.radiusM, budget: 'any', preferences: input.preferences, addons: input.addons, placeIds: cached.places.map((place) => place.id), cacheHit: true });
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Loading this search from memory', status: 'done', summary: `${cached.places.length} places, searched recently` });
    const result = { cacheHit: true, fingerprint: key, headline: cached.headline, reason: cached.reason, places: cached.places.map(present), trace: cached.trace || [] };
    emit({ type: 'done', result });
    return result;
  }

  const state: State = {
    actor,
    user: { lat: input.lat, lng: input.lng },
    radiusM: input.radiusM,
    dish,
    candidates: new Map(),
    serpCalls: 0,
    serpCap: 12,
    stepId: 0,
    trace: [],
    emit,
  };

  const task = [
    `Craving: "${input.craving}" (search term: "${dish}").`,
    `User location: ${input.locationLabel || `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`}.`,
    `Radius chosen: ${distLabel(input.radiusM)}.`,
    `Preferences: ${input.preferences.join(', ') || 'none'}. Add-ons wanted: ${input.addons.join(', ') || 'none'}.`,
    wantsBest ? 'The user asked for the best, so prefer rating 4.0 and above.' : '',
    'Find and rank the places. Begin.',
  ]
    .filter(Boolean)
    .join('\n');

  let finish = await runLoop(state, SEARCH_SYSTEM, task, SEARCH_TOOLS, 'finish').catch((error) => {
    console.error('[agent]', error instanceof Error ? error.message : error);
    return null;
  });

  // Gemini down or gave up: run the plan ourselves so the user still gets an honest ranking.
  if (!finish) {
    if (!state.candidates.size) await execSearch(state, { query: dish, radius_m: input.radiusM, why: `Searching Google Maps for ${dish} within ${distLabel(input.radiusM)}` });
    const top = [...state.candidates.values()]
      .filter((candidate) => !candidate.reviewsRead)
      .sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0) || (a.place.distanceM ?? 0) - (b.place.distanceM ?? 0))
      .slice(0, 5 - [...state.candidates.values()].filter((candidate) => candidate.reviewsRead).length);
    if (top.length) await execReviews(state, { place_ids: top.map((candidate) => candidate.key), why: 'Reading recent Google reviews for the top candidates' });
    finish = {
      headline: state.candidates.size ? 'Ranked from rating and distance' : 'No open match nearby',
      reason: state.candidates.size ? 'The review reader was unavailable, so this order uses Google rating and distance only.' : 'Try a wider radius.',
      ranked: [...state.candidates.values()]
        .filter((candidate) => candidate.reviewsRead)
        .map((candidate) => ({ place_id: candidate.key, verdict: 'Ranked from rating and distance.', review_support: 15 })),
      _fallback: true,
    };
  }

  const rankedArgs = Array.isArray(finish.ranked) ? (finish.ranked as Record<string, unknown>[]) : [];
  const ordered: Place[] = [];
  for (const row of rankedArgs) {
    const candidate = state.candidates.get(String(row.place_id));
    if (!candidate || ordered.some((place) => place.dataId === candidate.place.dataId)) continue;
    const base = fallbackPoints(candidate.place, state.radiusM);
    const reviews = clamp(row.review_support, 30);
    const points = { ...base, reviews, total: base.distance + base.rating + base.price + reviews, source: finish._fallback ? ('fallback' as const) : ('gemini' as const) };
    ordered.push({ ...candidate.place, points, verdict: String(row.verdict || '').trim() || null });
    if (ordered.length >= 6) break;
  }

  const saved = await savePlaces(actor, ordered);
  const headline = String(finish.headline || (saved.length ? 'Review report' : 'No open match')).trim();
  const reason = String(finish.reason || (saved.length ? 'Built from reviews in the last 3 months.' : 'Try a wider radius.')).trim();
  const snapshot = { fingerprint: key, headline, reason, places: saved, expiresAt: Date.now() + 6 * 60 * 60 * 1000, trace: state.trace };
  rememberSearch(snapshot);
  await saveSearchSnapshot(actor, snapshot);
  await recordSearch(actor, { query: input.craving, lat: input.lat, lng: input.lng, radiusM: input.radiusM, budget: 'any', preferences: input.preferences, addons: input.addons, placeIds: saved.map((place) => place.id), cacheHit: false });
  void Promise.race([
    embedLater(actor, saved).catch((error) => console.error('[embed]', error instanceof Error ? error.message : error)),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  const result = { cacheHit: false, fingerprint: key, headline, reason, places: saved.map(present), trace: state.trace, serpCalls: state.serpCalls };
  emit({ type: 'done', result });
  return result;
}

// ---- Follow-up --------------------------------------------------------------------------------

const FOLLOWUP_SYSTEM = `You are YumAI, answering one follow-up question about places already on the user's map. You already hold their recent reviews. Answer from that evidence first.

Use tools only when the stored reviews cannot answer:
- read_reviews with more=true to read a deeper page for the places the question is about.
- web_search for things reviews rarely say (opening hours changes, a chef, a news item).
- get_directions when the question is about time to reach or which is closer by road.
Then call finish_answer. Pick a single place_id when the question asks which one; otherwise omit it.
Each tool call needs a short "why" sentence for the user. Budget: at most 4 tool calls. Never invent facts.`;

export async function runFollowUpAgent(
  actor: Actor,
  input: { fingerprint: string; question: string; lat?: number; lng?: number },
  emit: Emit,
) {
  await assertHospitality(input.question, 'followup');
  const snapshot = await readSearchStore(actor, input.fingerprint);
  if (!snapshot) throw new HttpError(404, 'Search again to refresh these places');

  const first = snapshot.places[0];
  const user = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : { lat: first?.lat ?? 0, lng: first?.lng ?? 0 };
  const state: State = {
    actor,
    user,
    radiusM: 10000,
    dish: '',
    candidates: new Map(),
    serpCalls: 0,
    serpCap: 4,
    stepId: 0,
    trace: [],
    emit,
  };
  snapshot.places.forEach((place, index) => {
    const key = `p${index + 1}`;
    state.candidates.set(key, { key, serp: null, place: { ...place }, nextToken: null, reviewsRead: true, route: null, webMentions: [] });
  });

  const task = [
    `Question: "${input.question}"`,
    'Places on the map, with the reviews already read:',
    JSON.stringify(
      [...state.candidates.values()].map((candidate) => ({
        ...briefPlace(candidate),
        verdict: candidate.place.verdict,
        reviews: briefReviews(candidate.place.reviews),
      })),
    ),
  ].join('\n');

  const finish = await runLoop(state, FOLLOWUP_SYSTEM, task, FOLLOWUP_TOOLS, 'finish_answer').catch((error) => {
    console.error('[agent followup]', error instanceof Error ? error.message : error);
    return null;
  });

  const chosen = finish?.place_id ? state.candidates.get(String(finish.place_id)) : null;
  const result = {
    headline: String(finish?.headline || 'From the saved reviews').trim(),
    reason: String(finish?.reason || (finish ? '' : 'The review reader was unavailable, so the map stays as it is.')).trim(),
    placeId: chosen?.place.id ?? null,
    verdict: chosen ? String(finish?.verdict || '').trim() || null : null,
    trace: state.trace,
  };
  emit({ type: 'done', result });
  return result;
}
