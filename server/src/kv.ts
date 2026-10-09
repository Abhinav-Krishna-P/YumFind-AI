import { createClient } from 'redis';
import { env } from './env.js';
import { TtlCache } from './memory.js';

/*
 * Key-value store for chat history, user memory and cached answers.
 * Redis when it is reachable (REDIS_URL, default redis://127.0.0.1:6379); otherwise process memory,
 * so the app still runs on a machine without Redis. Every key is prefixed with "yumfind:".
 */

const PREFIX = 'yumfind:';
const local = new TtlCache<string>(24 * 60 * 60 * 1000, 5000);

type Redis = ReturnType<typeof createClient>;
let connecting: Promise<Redis | null> | null = null;
let warned = false;

function warnOnce(message: string) {
  if (warned) return;
  warned = true;
  console.warn(`[kv] ${message}; using process memory instead of Redis`);
}

function redis() {
  connecting ||= (async () => {
    if (!env.redisUrl) {
      warnOnce('REDIS_URL is empty');
      return null;
    }
    const host = new URL(env.redisUrl).host;
    // Keeps retrying in the background (capped backoff), so Redis coming back later is picked up.
    const client = createClient({
      url: env.redisUrl,
      socket: { connectTimeout: 1500, reconnectStrategy: (retries) => Math.min(retries * 500, 10_000) },
    });
    client.on('error', (error: Error) => warnOnce(`Redis error: ${error.message}`));
    client.on('ready', () => console.log(`[kv] Redis connected (${host})`));
    void client.connect().catch(() => undefined);
    // Never make a request wait on Redis for more than ~2 s at startup.
    await new Promise<void>((resolve) => {
      if (client.isReady) return resolve();
      const timer = setTimeout(resolve, 2000);
      client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!client.isReady) warnOnce(`Redis unreachable at ${host}; will keep retrying`);
    return client;
  })();
  return connecting;
}

async function live() {
  const client = await redis();
  return client?.isReady ? client : null;
}

export async function kvBackend() {
  return (await live()) ? 'redis' : 'memory';
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const client = await live();
  let raw: string | null | undefined;
  try {
    raw = client ? await client.get(PREFIX + key) : local.get(key);
  } catch {
    raw = local.get(key);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown, ttlSeconds: number) {
  const raw = JSON.stringify(value);
  const client = await live();
  try {
    if (client) {
      await client.set(PREFIX + key, raw, { EX: ttlSeconds });
      return;
    }
  } catch {
    // Fall through to memory.
  }
  local.set(key, raw, ttlSeconds * 1000);
}

export async function kvDel(key: string) {
  local.delete(key);
  const client = await live();
  try {
    await client?.del(PREFIX + key);
  } catch {
    // Nothing else to clean.
  }
}

// Connect at startup so the first request does not wait on it.
void redis();
