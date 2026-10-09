import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Next } from 'hono';
import { HttpError } from './types.js';

/*
 * Request guards: per-caller rate limits (SerpApi credits and the OpenStreetMap queue are the
 * scarce resources) and input checks shared by the routes.
 */

const windows = new Map<string, { count: number; resets: number }>();

function caller(c: Context, by: 'user' | 'ip') {
  // Signed-in routes are keyed by the caller's token (an invalid one is rejected right after);
  // public routes only by address, so a made-up header cannot dodge the limit.
  const token = by === 'user' ? c.req.header('Authorization')?.slice(-24) : undefined;
  if (token) return `t:${token}`;
  try {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`;
  } catch {
    return 'ip:unknown';
  }
}

/** Allows `max` requests per minute per caller on this route. */
export function rateLimit(name: string, max: number, by: 'user' | 'ip' = 'user') {
  return async (c: Context, next: Next) => {
    const now = Date.now();
    const key = `${name}|${caller(c, by)}`;
    const current = windows.get(key);
    if (!current || current.resets < now) {
      windows.set(key, { count: 1, resets: now + 60_000 });
    } else if (++current.count > max) {
      c.header('Retry-After', String(Math.ceil((current.resets - now) / 1000)));
      throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
    }
    if (windows.size > 10_000) {
      for (const [entry, value] of windows) if (value.resets < now) windows.delete(entry);
      // Still flooded with live keys: start over rather than grow without bound.
      if (windows.size > 20_000) windows.clear();
    }
    await next();
  };
}

/** Request JSON; a malformed body is the caller's mistake (400), unlike upstream parse errors. */
export async function readJson<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new HttpError(400, 'Bad request');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A place id as stored in Supabase. */
export function placeId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(id)) throw new HttpError(400, 'Unknown place');
  return id;
}

/** A search fingerprint as produced by geo.ts (geohash|craving|radius|...). */
export function searchKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 300) throw new HttpError(400, 'Search again to refresh these places');
  return key;
}
