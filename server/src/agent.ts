import { judgeTwins, toolTurn, type Content, type FunctionDeclaration, type Part, type Usage } from './gemini.js';
import { dishQuery, fingerprint, geohash, haversine } from './geo.js';
import { ANSWER_TTL, answerKey, appendChat, chatContext, learn, loadChat, loadMemory, messageId, type ChatMessage } from './chat.js';
import { kvGet, kvSet } from './kv.js';
import { embedLater, present } from './pipeline.js';
import { FOLLOWUP_SYSTEM, FOLLOWUP_TOOLS, PROMPT_VERSION, SEARCH_SYSTEM, SEARCH_TOOLS, followupTask, searchTask } from './prompts.js';
import { fallbackPoints, preScore } from './rank.js';
import { normalize } from './memory.js';
import { menuLines } from './menu.js';
import { contributorReviews, cravingPlaces, drivingRoute, reviewPages, webSearch, type ContributorReview, type SerpPlace, type WebHit } from './serp.js';
import { readFreshReviews, readSearchStore, recordSearch, rememberSearch, savePlaces, saveSearchSnapshot } from './store.js';
import { assertHospitality } from './topic.js';
import { HttpError, type Actor, type Place, type Review, type Reviewer, type TasteTwin, type TraceStep } from './types.js';

/*
 * YumFindAI as an agent. Gemini decides which SerpApi engines to call and when:
 *   search_places   -> engine=google_maps          (can change radius / open-now / min rating itself)
 *   read_reviews    -> engine=google_maps_reviews  (newest first, several places in parallel, can page deeper)
 *   web_search      -> engine=google               (local food blogs, "best X in Y" lists)
 *   get_directions  -> engine=google_maps_directions
 *   finish          -> the ranked answer, with a verdict per place drawn only from what it read
 * Every tool call carries a `why` sentence that the map shows live as the agent works.
 *
 * Keeping it cheap:
 *   - The context stays flat: every tool result carries a compact CANDIDATES table (the agent's memory),
 *     and older tool results shrink to one-line briefs, so turn 8 costs about what turn 2 does.
 *   - Reviews are relevance-ranked against the craving (or the question) and clipped before the model sees them.
 *   - Reviews another search fetched in the last 7 days come from Supabase instead of SerpApi.
 *   - Tool calls the model makes in the same step run in parallel.
 *   - Follow-ups are a chat: history, taste memory and answers live in Redis (chat.ts), and only the last
 *     few exchanges reach the model, as one short line each.
 */

export type AgentEvent =
  | { type: 'step'; id: number; tool: string; say: string; status: 'running' }
  | { type: 'step'; id: number; tool: string; say: string; status: 'done'; summary: string }
  | { type: 'places'; places: ReturnType<typeof present>[] }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

export type Emit = (event: AgentEvent) => void;

/** What one agent run cost, returned to the client and logged. */
export type RunUsage = {
  cacheHit: boolean;
  turns: number;
  serpCalls: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

type Candidate = {
  key: string;
  serp: SerpPlace | null;
  place: Place;
  nextToken: string | null;
  reviewsRead: boolean;
  /** Reviews came from storage, so there is no SerpApi page token yet. */
  fromCache: boolean;
  route: { distance: string | null; duration: string | null } | null;
  webMentions: number;
};

type State = {
  actor: Actor;
  user: { lat: number; lng: number };
  radiusM: number;
  dish: string;
  /** Word skeletons reviews are ranked against: dish + preferences, or the follow-up question. */
  focus: Set<string>;
  dishFocus: Set<string>;
  candidates: Map<string, Candidate>;
  serpCalls: number;
  serpCap: number;
  searches: number;
  stepId: number;
  trace: TraceStep[];
  emit: Emit;
  usage: Usage & { turns: number };
};

type ToolResult = { response: Record<string, unknown>; brief: Record<string, unknown> };
type FunctionCallPart = Extract<Part, { functionCall: unknown }>;
type FunctionResponsePart = Extract<Part, { functionResponse: unknown }>;

const MAX_TURNS = 8;
const MAX_SEARCHES = 3;
const DAY = 86_400_000;
const BUDGET_GONE = { error: 'SerpApi budget for this run is used up. Finish with the evidence in CANDIDATES.' };
const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'with', 'which', 'what', 'where', 'when', 'that', 'this', 'there', 'they', 'them',
  'have', 'has', 'from', 'your', 'about', 'than', 'more', 'less', 'most', 'best', 'good', 'place', 'places', 'one',
  'food', 'near', 'nearby', 'some', 'any', 'how', 'who', 'can', 'get', 'out', 'very', 'really', 'also',
]);

// ---- Small helpers ----------------------------------------------------------------------------

function clamp(value: unknown, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}

function distLabel(meters: number | null) {
  if (meters == null) return 'unknown distance';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Drops keys that carry no information so the model is not sent them. */
function compact(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)),
  );
}

/** "biryani" ~ "biriyani" ~ "biriyaani": words compared by consonant skeleton so local spellings still match. */
function skeleton(word: string) {
  return word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function focusWords(...texts: string[]) {
  const words = new Set<string>();
  for (const text of texts) {
    for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
      if (raw.length < 3 || STOP.has(raw)) continue;
      const sk = skeleton(raw);
      if (sk.length >= 2) words.add(sk);
    }
  }
  return words;
}

function hits(text: string, focus: Set<string>) {
  if (!focus.size) return 0;
  const seen = new Set<string>();
  for (const raw of text.split(/[^A-Za-z]+/)) {
    const sk = skeleton(raw);
    if (focus.has(sk)) seen.add(sk);
  }
  return seen.size;
}

function ageDays(review: Review) {
  return Math.max(0, Math.round((Date.now() - new Date(review.publishedAt).getTime()) / DAY));
}

/** Most relevant reviews first (by focus words), newest first among equals. */
function relevant(reviews: Review[], focus: Set<string>, n: number) {
  return reviews
    .map((review) => ({ review, score: hits(review.snippet, focus) }))
    .sort((a, b) => b.score - a.score || b.review.publishedAt.localeCompare(a.review.publishedAt))
    .slice(0, n)
    .map(({ review }) => review);
}

function reviewLines(reviews: Review[], focus: Set<string>, n: number, max: number) {
  return relevant(reviews, focus, n).map((review) => compact({ age_days: ageDays(review), rating: review.rating, text: clip(review.snippet, max) }));
}

function mentions(candidate: Candidate, state: State) {
  return candidate.place.reviews.filter((review) => hits(review.snippet, state.dishFocus) > 0).length;
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
    hours: serp.hours,
    distanceM: haversine(user.lat, user.lng, serp.lat, serp.lng),
    reviews: [],
    points: null,
    verdict: null,
    evidence: [],
    dishes: [],
  };
}

const GENERIC_DISHES = /^(meals?|food|dishes|lunch|dinner|breakfast|snacks?|starters?|desserts?)$/i;

/** Keeps only dish names the reviews actually mention (spelling-tolerant), at most three. */
function praisedDishes(value: unknown, reviews: Review[]) {
  if (!Array.isArray(value)) return [];
  const names = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => clip(item, 28))
    .filter((item) => item && !GENERIC_DISHES.test(item));
  return names.filter((name) => reviews.some((review) => hits(review.snippet, focusWords(name)) > 0)).slice(0, 3);
}

function reviewWithFor(candidate: Candidate) {
  if (candidate.serp) return candidate.serp.reviewWith;
  const dataId = candidate.place.dataId;
  return dataId.startsWith('pid:') ? { place_id: dataId.slice(4) } : { data_id: dataId };
}

function setEvidence(candidate: Candidate, state: State) {
  candidate.place.evidence = relevant(candidate.place.reviews, state.focus, 3).map((review) => ({ text: review.snippet, publishedAt: review.publishedAt }));
}

/** The agent's working memory, attached to the newest tool result each turn. */
function sheet(state: State, lastStep: boolean) {
  const order = (candidate: Candidate) =>
    preScore({ distanceM: candidate.place.distanceM ?? state.radiusM, rating: candidate.place.rating }, state.radiusM);
  const rows = [...state.candidates.values()]
    .sort((a, b) => Number(b.reviewsRead) - Number(a.reviewsRead) || order(b) - order(a))
    .slice(0, 10)
    .map((candidate) =>
      compact({
        place_id: candidate.key,
        name: candidate.place.name,
        rating: candidate.place.rating,
        reviews_total: candidate.place.reviewsCount,
        price: candidate.place.priceLevel,
        distance: distLabel(candidate.place.distanceM),
        closed: candidate.place.openNow === false ? true : undefined,
        read: candidate.reviewsRead ? candidate.place.reviews.length : undefined,
        dish_mentions: candidate.reviewsRead && state.dishFocus.size ? mentions(candidate, state) : undefined,
        evidence: candidate.reviewsRead ? relevant(candidate.place.reviews, state.focus, 2).map((review) => clip(review.snippet, 150)) : undefined,
        web_mentions: candidate.webMentions || undefined,
        drive: candidate.route?.duration ?? undefined,
        more_pages: candidate.nextToken ? true : undefined,
      }),
    );
  return compact({
    serp_budget_left: state.serpCap - state.serpCalls,
    places: rows,
    note: lastStep ? 'Last step: finish now.' : undefined,
  });
}

// ---- Tool execution ---------------------------------------------------------------------------

// ---- Reviewer identities (for Taste Twins) ------------------------------------------------------
// place_reviews has no reviewer column, so who wrote each review is kept in Redis per place.

const REVIEWER_TTL = 30 * 24 * 60 * 60;

async function rememberReviewers(dataId: string, reviews: Review[]) {
  const fresh = reviews.filter((review) => review.reviewer);
  if (!fresh.length) return;
  const key = `reviewers:${dataId}`;
  const known = (await kvGet<Record<string, Reviewer>>(key)) ?? {};
  for (const review of fresh) known[review.sourceId] = review.reviewer as Reviewer;
  await kvSet(key, known, REVIEWER_TTL);
}

async function recallReviewers(dataId: string, reviews: Review[]) {
  const known = await kvGet<Record<string, Reviewer>>(`reviewers:${dataId}`);
  if (!known) return;
  for (const review of reviews) review.reviewer ||= known[review.sourceId] ?? null;
}

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

function same(response: Record<string, unknown>): ToolResult {
  return { response, brief: response };
}

function emitPlaces(state: State) {
  state.emit({ type: 'places', places: [...state.candidates.values()].map((candidate) => present(candidate.place)) });
}

async function execSearch(state: State, args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query || state.dish).trim() || state.dish;
  const radiusM = [1000, 2000, 5000, 10000].includes(Number(args.radius_m)) ? Number(args.radius_m) : state.radiusM;
  if (state.searches >= MAX_SEARCHES) return same({ error: `Search limit reached (${MAX_SEARCHES}). Read reviews for CANDIDATES or finish.` });
  state.searches += 1;
  const done = step(state, 'search_places', String(args.why || `Searching Google Maps for ${query}`));
  if (!spend(state)) {
    done('Skipped: budget used up');
    return same(BUDGET_GONE);
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
    return same({ error: error instanceof Error ? error.message : 'search failed' });
  }
  state.radiusM = Math.max(state.radiusM, radiusM);
  let fresh = 0;
  for (const serp of found) {
    const place = toPlace(serp, state.user);
    if ((place.distanceM ?? Infinity) > radiusM) continue;
    if ([...state.candidates.values()].some((candidate) => candidate.place.dataId === serp.dataId)) continue;
    const key = `p${state.candidates.size + 1}`;
    state.candidates.set(key, { key, serp, place, nextToken: null, reviewsRead: false, fromCache: false, route: null, webMentions: 0 });
    fresh += 1;
  }
  const inRadius = [...state.candidates.values()].filter((candidate) => (candidate.place.distanceM ?? Infinity) <= radiusM).length;
  done(`${found.length} results, ${inRadius} within ${distLabel(radiusM)}${fresh ? `, ${fresh} new` : ''}`);
  if (fresh) emitPlaces(state);
  return {
    response: { query, radius_m: radiusM, results: found.length, in_radius: inRadius, new_places: fresh },
    brief: { query, radius_m: radiusM, new_places: fresh },
  };
}

async function readOne(state: State, candidate: Candidate, more: boolean, justCached: boolean) {
  const base = { place_id: candidate.key, name: candidate.place.name };
  if (justCached) {
    return { row: { ...base, reviews: reviewLines(candidate.place.reviews, state.focus, 6, 220), from_cache: true }, added: candidate.place.reviews.length };
  }
  if (!more && candidate.reviewsRead) return { row: { ...base, note: 'Already read; see CANDIDATES.' }, added: 0 };
  if (more && !candidate.nextToken && !candidate.fromCache) return { row: { ...base, note: 'No more reviews from the last 3 months.' }, added: 0 };
  if (!spend(state)) return { row: { ...base, ...BUDGET_GONE }, added: 0 };
  try {
    // Stored reviews have no page token, so a deeper read starts at page one and skips what is known.
    const startToken = more && !candidate.fromCache ? candidate.nextToken || undefined : undefined;
    const result = await reviewPages(reviewWithFor(candidate), AbortSignal.timeout(20000), { maxPages: 1, startToken });
    const seen = new Set(candidate.place.reviews.map((review) => review.sourceId));
    const added = result.reviews.filter((review) => !seen.has(review.sourceId));
    candidate.place.reviews = [...candidate.place.reviews, ...added];
    void rememberReviewers(candidate.place.dataId, added).catch(() => undefined);
    candidate.nextToken = result.nextToken;
    candidate.reviewsRead = true;
    candidate.fromCache = false;
    setEvidence(candidate, state);
    return {
      row: compact({ ...base, reviews: reviewLines(added, state.focus, 6, 220), more_available: result.nextToken ? true : undefined }),
      added: added.length,
    };
  } catch (error) {
    return { row: { ...base, error: error instanceof Error ? error.message : 'reviews failed' }, added: 0 };
  }
}

async function execReviews(state: State, args: Record<string, unknown>): Promise<ToolResult> {
  const ids = Array.isArray(args.place_ids) ? args.place_ids.map(String) : args.place_id ? [String(args.place_id)] : [];
  const picked = ids.map((id) => state.candidates.get(id)).filter((candidate): candidate is Candidate => Boolean(candidate)).slice(0, 6);
  if (!picked.length) return same({ error: 'No known place_ids given. Use ids from CANDIDATES.' });
  const more = args.more === true;
  const names = picked.map((candidate) => candidate.place.name);
  const label = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  const done = step(state, 'read_reviews', String(args.why || `Reading recent Google reviews for ${label}`));

  // Reviews another search fetched this week cost no SerpApi call.
  const unread = picked.filter((candidate) => !candidate.reviewsRead);
  const stored = unread.length
    ? await readFreshReviews(state.actor, unread.map((candidate) => candidate.place.dataId)).catch(() => new Map<string, Review[]>())
    : new Map<string, Review[]>();
  const justCached = new Set<Candidate>();
  for (const candidate of unread) {
    const reviews = stored.get(candidate.place.dataId);
    if (!reviews?.length) continue;
    await recallReviewers(candidate.place.dataId, reviews).catch(() => undefined);
    // Reviews cached before reviewer ids were kept cannot feed Taste Twins: read those fresh once.
    if (!reviews.some((review) => review.reviewer)) continue;
    candidate.place.reviews = reviews;
    candidate.reviewsRead = true;
    candidate.fromCache = true;
    candidate.nextToken = null;
    setEvidence(candidate, state);
    justCached.add(candidate);
  }

  const results = await Promise.all(
    picked.map((candidate) => readOne(state, candidate, more && candidate.reviewsRead && !justCached.has(candidate), justCached.has(candidate))),
  );
  const added = results.reduce((sum, result) => sum + result.added, 0);
  const where = picked.length === 1 ? picked[0].place.name : `${picked.length} places`;
  const cachedNote = justCached.size ? ` (${justCached.size} from cache)` : '';
  if (state.dishFocus.size) {
    const mentioning = picked.filter((candidate) => mentions(candidate, state) > 0).length;
    done(`${added} recent reviews across ${where}${cachedNote}; ${mentioning} mention the dish`);
  } else {
    done(`${added} more recent reviews for ${where}${cachedNote}`);
  }
  return {
    response: { places: results.map((result) => result.row) },
    brief: { read: picked.map((candidate) => candidate.key) },
  };
}

async function execWeb(state: State, args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query || '').trim();
  if (!query) return same({ error: 'query is required' });
  const done = step(state, 'web_search', String(args.why || `Searching the web for ${query}`));
  if (!spend(state)) {
    done('Skipped: budget used up');
    return same(BUDGET_GONE);
  }
  try {
    // The same web query is answered from Redis for a day, so a repeat costs nothing.
    const cacheKey = `web:${normalize(query)}`;
    const found = (await kvGet<WebHit[]>(cacheKey)) ?? (await webSearch(query, AbortSignal.timeout(8000)));
    void kvSet(cacheKey, found, 24 * 60 * 60).catch(() => undefined);
    for (const candidate of state.candidates.values()) {
      const name = candidate.place.name.toLowerCase();
      candidate.webMentions += found.filter((hit) => `${hit.title} ${hit.snippet}`.toLowerCase().includes(name)).length;
    }
    const mentioned = [...state.candidates.values()].filter((candidate) => candidate.webMentions).map((candidate) => candidate.key);
    done(`${found.length} results${mentioned.length ? `, mentions ${mentioned.length} of the candidates` : ''}`);
    return {
      response: { results: found.slice(0, 6).map((hit) => ({ title: clip(hit.title, 90), snippet: clip(hit.snippet, 160) })), candidates_mentioned: mentioned },
      brief: { query, candidates_mentioned: mentioned },
    };
  } catch (error) {
    done('Web search failed');
    return same({ error: error instanceof Error ? error.message : 'web search failed' });
  }
}

async function execDirections(state: State, args: Record<string, unknown>): Promise<ToolResult> {
  const candidate = state.candidates.get(String(args.place_id));
  if (!candidate) return same({ error: `Unknown place_id ${String(args.place_id)}` });
  const done = step(state, 'get_directions', String(args.why || `Checking the drive to ${candidate.place.name}`));
  if (candidate.route) {
    done(`${candidate.route.duration || '?'} · ${candidate.route.distance || '?'}`);
    return same({ place_id: candidate.key, ...candidate.route });
  }
  if (!spend(state)) {
    done('Skipped: budget used up');
    return same(BUDGET_GONE);
  }
  try {
    const route = await drivingRoute(state.user, { lat: candidate.place.lat, lng: candidate.place.lng }, AbortSignal.timeout(12000));
    candidate.route = { distance: route.distance, duration: route.duration };
    done(`${route.duration || '?'} drive · ${route.distance || '?'}`);
    return same({ place_id: candidate.key, duration: route.duration, distance: route.distance });
  } catch (error) {
    done('Directions unavailable');
    return same({ error: error instanceof Error ? error.message : 'directions failed' });
  }
}

function execTool(state: State, name: string, args: Record<string, unknown>): Promise<ToolResult> {
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
      return Promise.resolve(same({ error: `Unknown tool ${name}` }));
  }
}

// ---- The loop ---------------------------------------------------------------------------------

type Finish = Record<string, unknown> | null;

/**
 * Runs model turns until the model calls `finishTool`; returns its args, or null when the model gave up.
 * Before each new turn, the previous tool results are swapped for their briefs. Only the response payloads
 * change, never the model's own parts, so Gemini's thought signatures stay intact.
 */
async function runLoop(state: State, system: string, task: string, tools: FunctionDeclaration[], finishTool: string): Promise<Finish> {
  const contents: Content[] = [{ role: 'user', parts: [{ text: task }] }];
  let pending: { part: FunctionResponsePart; brief: Record<string, unknown> }[] = [];
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const model = await toolTurn(system, contents, tools, { onUsage: (usage) => addUsage(state, usage) });
    if (!model) return null;
    contents.push(model);
    const calls = model.parts.filter((part): part is FunctionCallPart => 'functionCall' in part);
    if (!calls.length) {
      contents.push({ role: 'user', parts: [{ text: `Use a tool, or call ${finishTool} with what you have.` }] });
      continue;
    }
    const finish = calls.find((call) => call.functionCall.name === finishTool);
    if (finish) return finish.functionCall.args || {};

    for (const { part, brief } of pending) part.functionResponse.response = brief;
    const results = await Promise.all(calls.map((call) => execTool(state, call.functionCall.name, call.functionCall.args || {})));
    const parts: FunctionResponsePart[] = results.map((result, index) => ({
      functionResponse: { name: calls[index].functionCall.name, response: result.response },
    }));
    const last = parts[parts.length - 1];
    last.functionResponse.response = { ...last.functionResponse.response, CANDIDATES: sheet(state, turn >= MAX_TURNS - 2) };
    contents.push({ role: 'user', parts });
    pending = parts.map((part, index) => ({ part, brief: results[index].brief }));
  }
  return null;
}

// ---- Usage ------------------------------------------------------------------------------------

function freshUsage() {
  return { turns: 0, prompt: 0, cached: 0, output: 0, thoughts: 0 };
}

function addUsage(state: State, usage: Usage) {
  state.usage.turns += 1;
  state.usage.prompt += usage.prompt;
  state.usage.cached += usage.cached;
  state.usage.output += usage.output;
  state.usage.thoughts += usage.thoughts;
}

function report(state: State, label: string): RunUsage {
  const u = state.usage;
  const cachedPct = u.prompt ? Math.round((u.cached / u.prompt) * 100) : 0;
  console.log(
    `[agent ${PROMPT_VERSION}] ${label}: ${u.turns} turns, ${state.serpCalls} SerpApi calls, prompt ${u.prompt} tok (${cachedPct}% cached), output ${u.output}, thinking ${u.thoughts}`,
  );
  return {
    cacheHit: false,
    turns: u.turns,
    serpCalls: state.serpCalls,
    promptTokens: u.prompt,
    cachedTokens: u.cached,
    outputTokens: u.output,
    thinkingTokens: u.thoughts,
  };
}

const CACHED_RUN: RunUsage = { cacheHit: true, turns: 0, serpCalls: 0, promptTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 };

function newState(actor: Actor, user: { lat: number; lng: number }, radiusM: number, emit: Emit, serpCap: number): State {
  return {
    actor,
    user,
    radiusM,
    dish: '',
    focus: new Set(),
    dishFocus: new Set(),
    candidates: new Map(),
    serpCalls: 0,
    serpCap,
    searches: 0,
    stepId: 0,
    trace: [],
    emit,
    usage: freshUsage(),
  };
}

// ---- Taste Twins ------------------------------------------------------------------------------

const MAX_TWIN_CANDIDATES = 5;
const TWIN_MATCH = 60;

/**
 * Finds reviewers of the ranked places who eat like the user: reads their wider review history
 * (SerpApi google_maps_contributor_reviews, cached 7 days), has Gemini score each against the user's
 * taste, attaches the twins to the places they reviewed, and nudges places twins loved up the list.
 */
async function matchTwins(state: State, places: Place[], taste: string) {
  const picked = new Map<string, Reviewer>();
  for (const place of places.slice(0, 4)) {
    const seasoned = place.reviews
      .filter((review) => review.reviewer && (review.reviewer.reviewCount ?? 0) >= 5)
      .sort((a, b) => hits(b.snippet, state.focus) - hits(a.snippet, state.focus) || (b.reviewer?.reviewCount ?? 0) - (a.reviewer?.reviewCount ?? 0))
      .slice(0, 2);
    for (const review of seasoned) if (picked.size < MAX_TWIN_CANDIDATES) picked.set((review.reviewer as Reviewer).id, review.reviewer as Reviewer);
  }
  if (!picked.size) return places;

  const done = step(state, 'taste_twins', 'Finding reviewers who eat like you');
  const histories = await Promise.all(
    [...picked.values()].map(async (reviewer) => {
      const key = `contrib:${reviewer.id}`;
      const cached = await kvGet<ContributorReview[]>(key);
      if (cached) return { reviewer, history: cached };
      state.serpCalls += 1;
      try {
        const history = await contributorReviews(reviewer.id, AbortSignal.timeout(12000));
        void kvSet(key, history, 7 * 24 * 60 * 60).catch(() => undefined);
        return { reviewer, history };
      } catch {
        return { reviewer, history: [] as ContributorReview[] };
      }
    }),
  );
  const candidates = histories
    .filter((row) => row.history.length)
    .map((row) => ({
      id: row.reviewer.id,
      name: row.reviewer.name,
      history: row.history.slice(0, 12).map((item) => ({ place: item.place, type: item.type, rating: item.rating, snippet: clip(item.snippet, 120) })),
    }));
  const scores = await judgeTwins(taste, candidates).catch((error) => {
    console.error('[twins]', error instanceof Error ? error.message : error);
    return new Map<string, { match: number; why: string }>();
  });

  let found = 0;
  const withTwins = places.map((place, index) => {
    const twins: TasteTwin[] = [];
    for (const review of place.reviews) {
      const reviewer = review.reviewer;
      const score = reviewer ? scores.get(reviewer.id) : undefined;
      if (!reviewer || !score || score.match < TWIN_MATCH || twins.some((twin) => twin.name === reviewer.name)) continue;
      twins.push({
        name: reviewer.name || 'A reviewer',
        photo: reviewer.photo,
        localGuide: reviewer.localGuide,
        match: score.match,
        why: score.why,
        rating: review.rating,
        said: clip(review.snippet, 180),
      });
    }
    twins.sort((a, b) => b.match - a.match);
    found += twins.length;
    // Twins who loved a place lift it; twins who disliked it drop it (about one slot per twin).
    const lift = Math.max(-2, Math.min(2, twins.reduce((sum, twin) => sum + ((twin.rating ?? 3) >= 4 ? 1 : (twin.rating ?? 3) <= 2 ? -1 : 0), 0)));
    return { place: { ...place, twins: twins.slice(0, 3) }, order: index - lift * 1.01 };
  });
  done(`${candidates.length} reviewers' histories read; ${found ? `${found} taste twin${found === 1 ? '' : 's'} found` : 'no close taste match yet'}`);
  return withTwins.sort((a, b) => a.order - b.order).map((row) => row.place);
}

// ---- Search -----------------------------------------------------------------------------------

export async function runSearchAgent(
  actor: Actor,
  input: { craving: string; lat: number; lng: number; radiusM: number; preferences: string[]; addons: string[]; locationLabel?: string },
  emit: Emit,
) {
  await assertHospitality(input.craving, 'search');
  const dish = dishQuery(input.craving);
  if (!dish) throw new HttpError(400, 'Say what you want to eat');
  const wantsBest = /\bbest\b|highly rated/i.test(input.craving);
  const memory = await loadMemory(actor.userId);
  // Results are shaped by the user's remembered taste (prompt and Taste Twins), so the cache key includes it.
  const key = `${fingerprint({ ...input, wantsBest })}${memory.length ? `|m:${memory.join(',')}` : ''}`;

  const cached = await readSearchStore(actor, key);
  if (cached) {
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Loading this search from memory', status: 'running' });
    await recordSearch(actor, { query: input.craving, lat: input.lat, lng: input.lng, radiusM: input.radiusM, budget: 'any', preferences: input.preferences, addons: input.addons, placeIds: cached.places.map((place) => place.id), cacheHit: true });
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Loading this search from memory', status: 'done', summary: `${cached.places.length} places, searched recently; no new SerpApi calls` });
    const result = { cacheHit: true, fingerprint: key, headline: cached.headline, reason: cached.reason, places: cached.places.map(present), trace: cached.trace || [], usage: CACHED_RUN };
    emit({ type: 'done', result });
    return result;
  }

  void learn(actor.userId, [input.craving, ...input.preferences, ...input.addons].join(' ')).catch(() => undefined);
  const state = newState(actor, { lat: input.lat, lng: input.lng }, input.radiusM, emit, 12);
  state.dish = dish;
  state.dishFocus = focusWords(dish);
  state.focus = focusWords(dish, ...input.preferences, ...input.addons);
  const task = searchTask({
    craving: input.craving,
    dish,
    where: input.locationLabel || `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`,
    radius: distLabel(input.radiusM),
    preferences: input.preferences,
    addons: input.addons,
    wantsBest,
    memory,
  });

  let finish = await runLoop(state, SEARCH_SYSTEM, task, SEARCH_TOOLS, 'finish').catch((error) => {
    console.error('[agent]', error instanceof Error ? error.message : error);
    return null;
  });

  // Gemini down or gave up: run the plan ourselves so the user still gets an honest ranking.
  if (!finish) {
    if (!state.candidates.size) await execSearch(state, { query: dish, radius_m: input.radiusM, why: `Searching Google Maps for ${dish} within ${distLabel(input.radiusM)}` });
    const read = [...state.candidates.values()].filter((candidate) => candidate.reviewsRead).length;
    const top = [...state.candidates.values()]
      .filter((candidate) => !candidate.reviewsRead)
      .sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0) || (a.place.distanceM ?? 0) - (b.place.distanceM ?? 0))
      .slice(0, Math.max(0, 5 - read));
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
    ordered.push({
      ...candidate.place,
      points,
      verdict: String(row.verdict || '').trim() || null,
      dishes: praisedDishes(row.dishes, candidate.place.reviews),
    });
    if (ordered.length >= 6) break;
  }

  const taste = [
    `Craving: ${input.craving}`,
    input.preferences.length || input.addons.length ? `Wants: ${[...input.preferences, ...input.addons].join(', ')}` : '',
    memory.length ? `Remembered taste: ${memory.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');
  const matched = finish._fallback ? ordered : await matchTwins(state, ordered, taste);

  const saved = await savePlaces(actor, matched);
  // Places that were read but not ranked still feed the review cache for the next search.
  const extra = [...state.candidates.values()]
    .filter((candidate) => candidate.reviewsRead && !candidate.fromCache && candidate.place.reviews.length)
    .filter((candidate) => !matched.some((place) => place.dataId === candidate.place.dataId))
    .map((candidate) => candidate.place);
  if (extra.length) void savePlaces(actor, extra).catch((error) => console.error('[cache] reviews', error instanceof Error ? error.message : error));

  const headline = String(finish.headline || (saved.length ? 'Review report' : 'No open match')).trim();
  const reason = String(finish.reason || (saved.length ? 'Built from reviews in the last 3 months.' : 'Try a wider radius.')).trim();
  const snapshot = { fingerprint: key, headline, reason, places: saved, expiresAt: Date.now() + 6 * 60 * 60 * 1000, trace: state.trace };
  // An empty result (no matches, or SerpApi failing) is not cached, so the next try searches again.
  if (saved.length) {
    rememberSearch(snapshot);
    await saveSearchSnapshot(actor, snapshot);
  }
  await recordSearch(actor, { query: input.craving, lat: input.lat, lng: input.lng, radiusM: input.radiusM, budget: 'any', preferences: input.preferences, addons: input.addons, placeIds: saved.map((place) => place.id), cacheHit: false });
  void Promise.race([
    embedLater(actor, saved).catch((error) => console.error('[embed]', error instanceof Error ? error.message : error)),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  const usage = report(state, `search "${input.craving}"`);
  const result = { cacheHit: false, fingerprint: key, headline, reason, places: saved.map(present), trace: state.trace, serpCalls: state.serpCalls, usage };
  emit({ type: 'done', result });
  return result;
}

// ---- Follow-up chat ---------------------------------------------------------------------------

type FollowUpResult = {
  answer: string;
  headline: string;
  reason: string;
  placeId: string | null;
  verdict: string | null;
  trace: TraceStep[];
  usage: RunUsage;
};

/** One chat turn about a result set. Messages, taste memory and answers are kept in Redis via chat.ts. */
export async function runFollowUpAgent(
  actor: Actor,
  input: { fingerprint: string; question: string; lat?: number; lng?: number },
  emit: Emit,
) {
  await assertHospitality(input.question, 'followup');
  const snapshot = await readSearchStore(actor, input.fingerprint);
  if (!snapshot) throw new HttpError(404, 'Search again to refresh these places');

  const [messages, memory] = await Promise.all([loadChat(actor.userId, input.fingerprint), loadMemory(actor.userId)]);
  const asked: ChatMessage = { id: messageId(), role: 'user', text: input.question, at: Date.now() };
  // Drive times depend on where the asker is, so answers are shared only within ~5 km.
  const near = input.lat != null && input.lng != null ? geohash(input.lat, input.lng, 5) : '';
  const key = answerKey(input.fingerprint, input.question, messages, memory, near);
  const placeName = (id: string | null) => snapshot.places.find((place) => place.id === id)?.name ?? null;

  const known = await kvGet<Omit<FollowUpResult, 'usage'>>(key);
  if (known) {
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Answering from memory', status: 'running' });
    emit({ type: 'step', id: 1, tool: 'cache', say: 'Answering from memory', status: 'done', summary: 'Asked before in this context; no new calls' });
    const reply: ChatMessage = { id: messageId(), role: 'assistant', text: known.answer, at: Date.now(), placeId: known.placeId, placeName: placeName(known.placeId), cached: true };
    await appendChat(actor.userId, input.fingerprint, [asked, reply]);
    await learn(actor.userId, input.question).catch(() => undefined);
    const result = { ...known, usage: CACHED_RUN, messages: [asked, reply], memory: await loadMemory(actor.userId) };
    emit({ type: 'done', result });
    return result;
  }

  const first = snapshot.places[0];
  const user = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : { lat: first?.lat ?? 0, lng: first?.lng ?? 0 };
  const state = newState(actor, user, 10000, emit, 4);
  state.focus = focusWords(input.question);
  snapshot.places.forEach((place, index) => {
    const id = `p${index + 1}`;
    // Stored reviews: a deeper read can still fetch from SerpApi, starting at page one.
    state.candidates.set(id, { key: id, serp: null, place: { ...place }, nextToken: null, reviewsRead: true, fromCache: true, route: null, webMentions: 0 });
  });

  const menus = await Promise.all([...state.candidates.values()].map((candidate) => menuLines(candidate.place.dataId).catch(() => [])));
  const places = [...state.candidates.values()].map((candidate, index) =>
    compact({
      place_id: candidate.key,
      name: candidate.place.name,
      rating: candidate.place.rating,
      price: candidate.place.priceLevel,
      distance: distLabel(candidate.place.distanceM),
      verdict: candidate.place.verdict,
      reviews: reviewLines(candidate.place.reviews, state.focus, 5, 200),
      taste_twins: candidate.place.twins?.map((twin) => ({ name: twin.name, match: twin.match, why: twin.why, said: twin.said })),
      menu: menus[index],
    }),
  );
  const task = followupTask(input.question, chatContext(messages), memory, places);

  const finish = await runLoop(state, FOLLOWUP_SYSTEM, task, FOLLOWUP_TOOLS, 'finish_answer').catch((error) => {
    console.error('[agent followup]', error instanceof Error ? error.message : error);
    return null;
  });

  const chosen = finish?.place_id ? state.candidates.get(String(finish.place_id)) : null;
  const usage = report(state, `chat "${input.question}"`);
  const headline = String(finish?.headline || 'From the saved reviews').trim();
  const reason = String(finish?.reason || (finish ? '' : 'The review reader was unavailable, so the map stays as it is.')).trim();
  const answer = String(finish?.answer || '').trim() || [headline, reason].filter(Boolean).join('. ');
  const result: FollowUpResult = {
    answer,
    headline,
    reason,
    placeId: chosen?.place.id ?? null,
    verdict: chosen ? String(finish?.verdict || '').trim() || null : null,
    trace: state.trace,
    usage,
  };
  const reply: ChatMessage = {
    id: messageId(),
    role: 'assistant',
    text: answer,
    at: Date.now(),
    placeId: result.placeId,
    placeName: chosen?.place.name ?? null,
    steps: state.trace,
  };
  await appendChat(actor.userId, input.fingerprint, [asked, reply]);
  await learn(actor.userId, input.question).catch(() => undefined);
  if (finish) {
    const { usage: _usage, ...answerOnly } = result;
    await kvSet(key, answerOnly, ANSWER_TTL);
  }
  const done = { ...result, messages: [asked, reply], memory: await loadMemory(actor.userId) };
  emit({ type: 'done', result: done });
  return done;
}
