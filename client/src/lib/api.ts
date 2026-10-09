import { supabase } from './supabase';

export type Points = {
  total: number;
  distance: number;
  rating: number;
  price: number;
  reviews: number;
  source: 'jev' | 'gemini' | 'fallback';
};

export type Place = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  reviewsCount: number | null;
  priceLevel: number | null;
  openNow: boolean | null;
  thumbnail: string | null;
  phone: string | null;
  website: string | null;
  /** Weekly hours from Google Maps, e.g. { monday: "11 am–1 am" }. */
  hours?: Record<string, string> | null;
  /** Dishes recent reviews praise here. */
  dishes?: string[];
  distanceM: number | null;
  points: Points | null;
  verdict: string | null;
  evidence: { text: string; publishedAt: string }[];
  sentiment?: { positive: number; neutral: number; negative: number };
  latestReview?: { author: string | null; rating: number | null; snippet: string; publishedAt: string } | null;
  reviews?: { author: string | null; rating: number | null; snippet: string; publishedAt: string }[];
};

export async function api<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json as T;
}

export type TraceStep = { tool: string; say: string; summary: string };
/** What an agent run cost; `cacheHit` means it was answered from memory. */
export type RunUsage = {
  cacheHit: boolean;
  turns: number;
  serpCalls: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};
export type AgentStep = { id: number; tool: string; say: string; status: 'running' | 'done'; summary?: string };
export type AgentEvent<T> =
  | { type: 'step'; id: number; tool: string; say: string; status: 'running' | 'done'; summary?: string }
  | { type: 'places'; places: Place[] }
  | { type: 'done'; result: T }
  | { type: 'error'; message: string };

/** POST to an agent route and read its newline-delimited JSON events as they arrive. Resolves with the `done` result. */
export async function apiStream<T>(path: string, body: unknown, onEvent: (event: AgentEvent<T>) => void): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || 'Request failed');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AgentEvent<T>;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') result = event.result;
    onEvent(event);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      handle(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  }
  handle(buffer);
  if (result === undefined) throw new Error('The search ended early');
  return result;
}

/** Keeps a step list in sync with streamed step events. */
export function upsertStep(steps: AgentStep[], event: Extract<AgentEvent<unknown>, { type: 'step' }>): AgentStep[] {
  const next: AgentStep = { id: event.id, tool: event.tool, say: event.say, status: event.status, summary: event.summary };
  const index = steps.findIndex((step) => step.id === event.id);
  if (index < 0) return [...steps, next];
  const copy = steps.slice();
  copy[index] = next;
  return copy;
}

/** A stored chat message for one result set (kept server-side in Redis). */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  placeId?: string | null;
  placeName?: string | null;
  steps?: TraceStep[];
  cached?: boolean;
};

/** JSON request with the user's session for routes that are not plain POSTs. */
export async function apiCall<T>(method: 'GET' | 'DELETE', path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json as T;
}
