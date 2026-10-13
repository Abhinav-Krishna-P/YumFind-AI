import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!key || !value || process.env[key]) continue;
    process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '../.env'));

export const env = {
  port: Number(process.env.PORT || 8787),
  /** Interface the API listens on; keep 127.0.0.1 unless you deploy behind a proxy. */
  host: process.env.API_HOST || '127.0.0.1',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  serp: process.env.SERPAPI_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  /** Gemini thinking level for agent turns. "low" spends far fewer thinking tokens; set GEMINI_THINKING= to use the model default. */
  geminiThinking: process.env.GEMINI_THINKING ?? 'low',
  /** Chat history, agent memory and answer cache. Unset or unreachable falls back to process memory. */
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  jev: process.env.TYPESAFE_AI_API_KEY || '',
  jevModel: process.env.JEV_MODEL || 'jev-latest',
  /** The built web app (client/dist). When it exists, this server serves the site and the API from one origin. */
  webDist: process.env.WEB_DIST || resolve(process.cwd(), '../client/dist'),
};
