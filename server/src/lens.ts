import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { dishFromLens } from './gemini.js';
import { HttpError } from './types.js';

/*
 * Snap a dish: a food photo becomes a dish name to search for.
 * Google Lens (SerpApi engine=google_lens) needs a public image URL, so the photo is put in a public
 * Supabase Storage bucket for the few seconds the lookup takes, then deleted.
 */

const BUCKET = 'dish-snaps';
const MAX_BYTES = 4 * 1024 * 1024;
let bucketReady: Promise<void> | null = null;

function storage() {
  if (!env.supabaseUrl || !env.serviceRole) throw new HttpError(503, 'Photo search needs Supabase storage to be configured');
  return createClient(env.supabaseUrl, env.serviceRole, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
}

function ensureBucket() {
  bucketReady ||= storage()
    .createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] })
    .then(() => undefined);
  return bucketReady.catch(() => undefined); // Already exists is fine.
}

async function lens(url: string) {
  const search = new URL('https://serpapi.com/search.json');
  search.search = new URLSearchParams({ engine: 'google_lens', url, hl: 'en', country: 'in', api_key: env.serp }).toString();
  const res = await fetch(search, { signal: AbortSignal.timeout(25000) });
  const body = (await res.json()) as { error?: string; ai_overview?: unknown; visual_matches?: { title?: string }[]; related_content?: { query?: string }[] };
  if (!res.ok || body.error) throw new HttpError(503, typeof body.error === 'string' ? body.error : 'Photo search is unavailable');
  return {
    overview: body.ai_overview ? JSON.stringify(body.ai_overview).slice(0, 1500) : '',
    titles: (body.visual_matches || []).map((match) => match.title || '').filter(Boolean).slice(0, 12),
    related: (body.related_content || []).map((item) => item.query || '').filter(Boolean).slice(0, 5),
  };
}

/** `image` is a data URL (data:image/jpeg;base64,...) from the browser. */
export async function identifyDish(image: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
  if (!match) throw new HttpError(400, 'Send a JPEG, PNG or WebP photo');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(400, 'That photo is too large');

  await ensureBucket();
  const bucket = storage().from(BUCKET);
  const name = `${randomUUID()}.${match[1].split('/')[1]}`;
  const { error } = await bucket.upload(name, bytes, { contentType: match[1], upsert: false });
  if (error) throw new HttpError(503, 'Could not prepare the photo for search');
  try {
    const found = await lens(bucket.getPublicUrl(name).data.publicUrl);
    const dish = await dishFromLens(found.overview, [...found.titles, ...found.related]);
    if (!dish?.dish) throw new HttpError(422, "That doesn't look like food. Try a photo of a dish.");
    return { dish: dish.dish, confidence: dish.confidence, seen: found.titles.slice(0, 3) };
  } finally {
    // The photo is only needed for the lookup.
    void bucket.remove([name]).catch(() => undefined);
  }
}
