import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { runFollowUpAgent, runSearchAgent, type AgentEvent } from './agent.js';
import { env } from './env.js';
import { validCoord } from './geo.js';
import { askFollowUp, cleanLists, findFood, findNearby } from './pipeline.js';
import { assertHospitality } from './topic.js';
import { placeName } from './reverse.js';
import { drivingRoute } from './serp.js';
import { authClient, recordVisit } from './store.js';
import { HttpError, type Actor } from './types.js';

const RADII = new Set([1000, 2000, 5000, 10000]);

const app = new Hono();
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }),
);

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
  console.error(error);
  return c.json({ error: 'Search is unavailable' }, 500);
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    serp: Boolean(env.serp),
    gemini: Boolean(env.gemini),
    jev: false,
    supabase: Boolean(env.supabaseUrl && env.supabaseKey),
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

app.post('/api/nearby', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{ lat?: number; lng?: number }>();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!validCoord(lat, lng)) throw new HttpError(400, 'Need a location');
  return c.json(await findNearby(user, lat, lng));
});

app.post('/api/topic', async (c) => {
  await actor(c);
  const body = await c.req.json<{ text?: string; mode?: string }>();
  const mode = body.mode === 'followup' ? 'followup' : 'search';
  await assertHospitality(String(body.text || ''), mode);
  return c.json({ ok: true });
});

app.post('/api/search', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{
    craving?: string;
    lat?: number;
    lng?: number;
    radiusM?: number;
    preferences?: unknown;
    addons?: unknown;
  }>();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusM = Number(body.radiusM);
  if (!validCoord(lat, lng)) throw new HttpError(400, 'Need a location');
  if (!RADII.has(radiusM)) throw new HttpError(400, 'Pick a radius');
  const lists = cleanLists(body.preferences, body.addons);
  return c.json(
    await findFood(user, {
      craving: String(body.craving || '').slice(0, 200),
      lat,
      lng,
      radiusM,
      ...lists,
    }),
  );
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

app.post('/api/agent/search', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{
    craving?: string;
    lat?: number;
    lng?: number;
    radiusM?: number;
    preferences?: unknown;
    addons?: unknown;
    locationLabel?: string;
  }>();
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

app.post('/api/agent/followup', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{ fingerprint?: string; question?: string; lat?: number; lng?: number }>();
  const question = String(body.question || '').trim().slice(0, 240);
  if (!body.fingerprint || !question) throw new HttpError(400, 'Ask about the places on the map');
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const input = { fingerprint: body.fingerprint, question, ...(validCoord(lat, lng) ? { lat, lng } : {}) };
  return streamAgent(c, (emit) => runFollowUpAgent(user, input, emit));
});

app.post('/api/followup', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{ fingerprint?: string; question?: string }>();
  const question = String(body.question || '').trim().slice(0, 240);
  if (!body.fingerprint || !question) throw new HttpError(400, 'Ask about the places on the map');
  return c.json(await askFollowUp(user, body.fingerprint, question));
});

app.post('/api/directions', async (c) => {
  await actor(c);
  const body = await c.req.json<{ startLat?: number; startLng?: number; endLat?: number; endLng?: number }>();
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

app.post('/api/where', async (c) => {
  await actor(c);
  const body = await c.req.json<{ lat?: number; lng?: number }>();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!validCoord(lat, lng)) throw new HttpError(400, 'Need a location');
  const label = await placeName(lat, lng, AbortSignal.timeout(8000)).catch(() => null);
  return c.json({ label });
});

app.post('/api/visits', async (c) => {
  const user = await actor(c);
  const body = await c.req.json<{ placeId?: string }>();
  if (!body.placeId) throw new HttpError(400, 'Missing place');
  const ok = await recordVisit(user, body.placeId);
  if (!ok) throw new HttpError(404, 'That place is not saved yet');
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: env.port }, () => {
  console.log(
    `YumFindAI API on :${env.port} serp=${flag(env.serp)} gemini=${flag(env.gemini)} jev=paused supabase=${flag(env.supabaseUrl)}`,
  );
});

function flag(value: string) {
  return value ? 'set' : 'missing';
}
