/*
 * Conversation state for the "Ask about these" chat, kept in Redis (see kv.ts):
 *   yumfind:chat:<user>:<search>  the messages of one chat about one result set (7 days)
 *   yumfind:memory:<user>         what YumFindAI has learned about the user's taste (30 days)
 *   yumfind:answer:<...>          answers to questions already asked in the same context (6 hours)
 * The model never gets the whole transcript: only the last few exchanges as short lines plus the memory facts.
 */
import { kvDel, kvGet, kvSet } from './kv.js';
import { normalize } from './memory.js';
import { PROMPT_VERSION } from './prompts.js';
import type { TraceStep } from './types.js';

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

const CHAT_TTL = 7 * 24 * 60 * 60;
const MEMORY_TTL = 30 * 24 * 60 * 60;
export const ANSWER_TTL = 6 * 60 * 60;
const MAX_MESSAGES = 60;
const CONTEXT_PAIRS = 6;

const chatKey = (userId: string, fingerprint: string) => `chat:${userId}:${fingerprint}`;
const memoryKey = (userId: string) => `memory:${userId}`;

export function messageId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function loadChat(userId: string, fingerprint: string) {
  return (await kvGet<ChatMessage[]>(chatKey(userId, fingerprint))) ?? [];
}

export async function appendChat(userId: string, fingerprint: string, messages: ChatMessage[]) {
  const all = [...(await loadChat(userId, fingerprint)), ...messages].slice(-MAX_MESSAGES);
  await kvSet(chatKey(userId, fingerprint), all, CHAT_TTL);
}

export async function clearChat(userId: string, fingerprint: string) {
  await kvDel(chatKey(userId, fingerprint));
}

/** The last few exchanges as one short line each: enough to resolve "it" and "there", cheap in tokens. */
export function chatContext(messages: ChatMessage[]) {
  const recent = messages.slice(-CONTEXT_PAIRS * 2);
  const lines = recent.map((message) =>
    message.role === 'user'
      ? `User: ${clip(message.text, 160)}`
      : `YumFindAI: ${clip(message.text, 220)}${message.placeName ? ` [pointed at ${message.placeName}]` : ''}`,
  );
  const older = messages.length - recent.length;
  return older > 0 ? [`(${older} earlier messages omitted)`, ...lines] : lines;
}

// ---- Long-term memory: taste facts learned from what the user asks and searches -----------------

const FACTS: [RegExp, string][] = [
  [/\b(pure veg|vegetarian|veg only|no meat|veg)\b/i, 'eats vegetarian'],
  [/\bmild\b|\b(least|less|not|non|no|low|without)\W+(too\W+)?(spic|hot\b|heat)/i, 'prefers mild food'],
  [/\b(spicy|extra hot|fiery)\b/i, 'likes spicy food'],
  [/\b(parking|car park|park the car)\b/i, 'cares about parking'],
  [/\b(family|families|kids|children|parents)\b/i, 'often eats with family'],
  [/\b(cheap|budget|affordable|inexpensive|pocket friendly)\b/i, 'watches the budget'],
  [/\b(outdoor|terrace|rooftop|garden|open air)\b/i, 'likes outdoor seating'],
  [/\b(quick|fast|in a hurry|takeaway|take away|quick bite)\b/i, 'wants quick service'],
  [/\b(quiet|calm|peaceful)\b/i, 'prefers quiet places'],
  [/\b(late night|open late|midnight)\b/i, 'eats late'],
];

type Memory = { facts: Record<string, number> };

function factsIn(text: string) {
  const found: string[] = [];
  for (const [pattern, fact] of FACTS) {
    if (fact === 'likes spicy food' && found.includes('prefers mild food')) continue;
    if (pattern.test(text)) found.push(fact);
  }
  return found;
}

/** Up to five facts, most often seen first. */
export async function loadMemory(userId: string) {
  const memory = await kvGet<Memory>(memoryKey(userId));
  return Object.entries(memory?.facts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([fact]) => fact);
}

export async function learn(userId: string, text: string) {
  const found = factsIn(text);
  if (!found.length) return;
  const memory = (await kvGet<Memory>(memoryKey(userId))) ?? { facts: {} };
  for (const fact of found) memory.facts[fact] = (memory.facts[fact] ?? 0) + 1;
  // Opposite tastes cannot both stand: the newer one wins.
  if (found.includes('prefers mild food')) delete memory.facts['likes spicy food'];
  if (found.includes('likes spicy food')) delete memory.facts['prefers mild food'];
  await kvSet(memoryKey(userId), memory, MEMORY_TTL);
}

export async function forget(userId: string) {
  await kvDel(memoryKey(userId));
}

/**
 * Same results + same question + same last answer + same taste memory = same reply.
 * A first question is shared across users with the same memory; later ones are per conversation.
 * The prompt version is part of the key, so changing the prompts retires old answers.
 */
export function answerKey(fingerprint: string, question: string, messages: ChatMessage[], memory: string[], near = '') {
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  const context = last ? `${normalize(last.text).slice(0, 80)}>${last.placeName ?? ''}` : '';
  return `answer:${PROMPT_VERSION}:${fingerprint}|${normalize(question)}|${context}|${memory.join(',')}|${near}`;
}
