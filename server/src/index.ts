import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { stream } from 'hono/streaming';
import { runFollowUpAgent, runSearchAgent, type AgentEvent } from './agent.js';
import { clearChat, forget, loadChat, loadMemory } from './chat.js';
import { env } from './env.js';
import { validCoord } from './geo.js';
import { placeId, rateLimit, readJson, searchKey } from './guard.js';
import { kvBackend } from './kv.js';
import { identifyDish } from './lens.js';
import { placeMenu } from './menu.js';
import { cleanLists } from './pipeline.js';
import { placeName } from './reverse.js';
import { drivingRoute } from './serp.js';
import { authClient, placeDataId, recordVisit } from './store.js';
import { assertHospitality } from './topic.js';
import { HttpError, type Actor } from './types.js';

const RADII = new Set([1000, 2000, 5000, 10000]);
const tooLarge = (c: Parameters<Parameters<typeof bodyLimit>[0]['onError'] & {}>[0]) => c.json({ error: 'That request is too large' }, 413);

const app = new Hono();
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }),
);
// Photos (Snap a dish) are the only large bodies; everything else is small JSON.
app.use('/api/dish/identify', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: tooLarge }));
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/dish/identify') return next();
  return bodyLimit({ maxSize: 100 * 1024, onError: tooLarge })(c, next);
});

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
  console.error(error);
  return c.json({ error: 'Search is unavailable' }, 500);
});

app.get('/api/health', async (c) =>
  c.json({
    ok: true,
    serp: Boolean(env.serp),
    gemini: Boolean(env.gemini),
    jev: false,
    supabase: Boolean(env.supabaseUrl && env.supabaseKey && env.serviceRole),
    cache: await kvBackend(),
  }),
);

async function actor(c: { req: { header: (name: string) => string | undefined } }): Promise<Actor> {
  const header = c.req.header('Authorization');
  const jwt = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!jwt) throw new HttpError(401, 'Sign in again');
  const supabase = authClient();
  if (!supabase) throw new HttpError(503, 'Auth is not configured');
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Sign in again');
  return { userId: data.user.id, jwt };
}

app.post('/api/topic', rateLimit('topic', 60), async (c) => {
  await actor(c);
  const body = await readJson<{ text?: string; mode?: string }>(c);
  const mode = body.mode === 'followup' ? 'followup' : 'search';
  await assertHospitality(String(body.text || '').slice(0, 240), mode);
  return c.json({ ok: true });
});

// Agent routes stream newline-delimited JSON events while YumFindAI works, ending with {type:"done"}.
function streamAgent(c: Parameters<typeof stream>[0], run: (emit: (event: AgentEvent) => void) => Promise<unknown>) {
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');
  return stream(c, async (out) => {
    const write = async (event: AgentEvent) => {
      await out.write(`${JSON.stringify(event)}\n`);
    };
    const queue: Promise<void>[] = [];
    try {
      await run((event) => {
        queue.push(write(event).catch(() => undefined));
      });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'Search is unavailable';
      if (!(error instanceof HttpError)) console.error(error);
      await write({ type: 'error', message });
    }
    await Promise.all(queue);
  });
}

// Each live search can spend up to ~17 SerpApi calls, so this is the tightest limit.
app.post('/api/agent/search', rateLimit('search', 6), async (c) => {
  const user = await actor(c);
  const body = await readJson<{
    craving?: string;
    lat?: number;
    lng?: number;
    radiusM?: number;
    preferences?: unknown;
    addons?: unknown;
    locationLabel?: string;
  }>(c);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusM = Number(body.radiusM);
  if (!validCoord(lat, lng)) throw new HttpError(400, 'Need a location');
  if (!RADII.has(radiusM)) throw new HttpError(400, 'Pick a radius');
  const lists = cleanLists(body.preferences, body.addons);
  const input = {
    craving: String(body.craving || '').slice(0, 200),
    lat,
    lng,
    radiusM,
    ...lists,
    locationLabel: typeof body.locationLabel === 'string' ? body.locationLabel.slice(0, 80) : undefined,
  };
  return streamAgent(c, (emit) => runSearchAgent(user, input, emit));
});

app.post('/api/agent/followup', rateLimit('chat', 20), async (c) => {
  const user = await actor(c);
  const body = await readJson<{ fingerprint?: string; question?: string; lat?: number; lng?: number }>(c);
  const question = String(body.question || '').trim().slice(0, 240);
  if (!question) throw new HttpError(400, 'Ask about the places on the map');
  const fingerprint = searchKey(body.fingerprint);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const input = { fingerprint, question, ...(validCoord(lat, lng) ? { lat, lng } : {}) };
  return streamAgent(c, (emit) => runFollowUpAgent(user, input, emit));
});

// Menu & prices: the place's Google Maps menu photos, read into dishes and prices (cached 14 days).
app.post('/api/place/menu', rateLimit('menu', 10), async (c) => {
  const user = await actor(c);
  const body = await readJson<{ placeId?: string }>(c);
  const dataId = await placeDataId(user, placeId(body.placeId));
  if (!dataId) throw new HttpError(404, 'That place is not saved yet');
  return c.json(await placeMenu(dataId));
});

// Snap a dish: a food photo (data URL) becomes a dish name via Google Lens.
app.post('/api/dish/identify', rateLimit('snap', 6), async (c) => {
  await actor(c);
  const body = await readJson<{ image?: string }>(c);
  return c.json(await identifyDish(String(body.image || '')));
});

// Chat history and taste memory for one result set ("Ask about these"), stored in Redis.
app.get('/api/agent/chat', rateLimit('history', 60), async (c) => {
  const user = await actor(c);
  const fingerprint = searchKey(c.req.query('fingerprint'));
  const [messages, memory, store] = await Promise.all([loadChat(user.userId, fingerprint), loadMemory(user.userId), kvBackend()]);
  return c.json({ messages, memory, store });
});

app.delete('/api/agent/chat', rateLimit('history', 60), async (c) => {
  const user = await actor(c);
  const fingerprint = c.req.query('fingerprint');
  if (fingerprint) await clearChat(user.userId, searchKey(fingerprint));
  if (c.req.query('memory') === '1') await forget(user.userId);
  return c.json({ ok: true });
});

app.post('/api/directions', rateLimit('directions', 30), async (c) => {
  await actor(c);
  const body = await readJson<{ startLat?: number; startLng?: number; endLat?: number; endLng?: number }>(c);
  const startLat = Number(body.startLat);
  const startLng = Number(body.startLng);
  const endLat = Number(body.endLat);
  const endLng = Number(body.endLng);
  if (!validCoord(startLat, startLng) || !validCoord(endLat, endLng)) throw new HttpError(400, 'Need a start and end');
  return c.json(
    await drivingRoute(
      { lat: startLat, lng: startLng },
      { lat: endLat, lng: endLng },
      AbortSignal.timeout(15000),
    ),
  );
});

// Public: Home asks "where am I?" before anyone signs in. Cached per ~150 m, throttled in reverse.ts.
app.post('/api/where', rateLimit('where', 20, 'ip'), async (c) => {
  const body = await readJson<{ lat?: number; lng?: number }>(c);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!validCoord(lat, lng)) throw new HttpError(400, 'Need a location');
  const label = await placeName(lat, lng, AbortSignal.timeout(8000)).catch(() => null);
  return c.json({ label });
});

app.post('/api/visits', rateLimit('visits', 60), async (c) => {
  const user = await actor(c);
  const body = await readJson<{ placeId?: string }>(c);
  const ok = await recordVisit(user, placeId(body.placeId));
  if (!ok) throw new HttpError(404, 'That place is not saved yet');
  return c.json({ ok: true });
});

// Local by default: the API is only reachable from this machine (Vite proxies to it).
serve({ fetch: app.fetch, port: env.port, hostname: env.host }, () => {
  console.log(
    `YumFindAI API on ${env.host}:${env.port} serp=${flag(env.serp)} gemini=${flag(env.gemini)} supabase=${flag(env.supabaseUrl)} service-role=${flag(env.serviceRole)}`,
  );
});

function flag(value: string) {
  return value ? 'set' : 'missing';
}
