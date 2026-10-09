/*
 * Every word the agent model sees, in one place. Kept short on purpose: the system prompt and tool
 * declarations are resent on every agent turn, so each sentence here costs tokens on every step.
 */
import type { FunctionDeclaration } from './gemini.js';

/** Bump when prompts change; it is logged with each run so token and quality numbers stay comparable. */
export const PROMPT_VERSION = 'agent-2026-10-09b';

const WHY = {
  type: 'STRING',
  description: 'One short present-tense line for the user naming the source, e.g. "Reading Google reviews for the 4 closest biryani spots".',
};

const READ_REVIEWS: FunctionDeclaration = {
  name: 'read_reviews',
  description:
    'Newest Google reviews from the last 3 months (SerpApi google_maps_reviews) for up to 6 places at once, fetched in parallel. more=true reads the next page.',
  parameters: {
    type: 'OBJECT',
    properties: { place_ids: { type: 'ARRAY', items: { type: 'STRING' } }, more: { type: 'BOOLEAN' }, why: WHY },
    required: ['place_ids', 'why'],
  },
};

const WEB_SEARCH: FunctionDeclaration = {
  name: 'web_search',
  description: 'Google web search (SerpApi google): food blogs, news, "best <dish> in <area>" lists, local dish names.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, why: WHY }, required: ['query', 'why'] },
};

const GET_DIRECTIONS: FunctionDeclaration = {
  name: 'get_directions',
  description: 'Driving time and distance from the user to one place (SerpApi google_maps_directions).',
  parameters: { type: 'OBJECT', properties: { place_id: { type: 'STRING' }, why: WHY }, required: ['place_id', 'why'] },
};

export const SEARCH_TOOLS: FunctionDeclaration[] = [
  {
    name: 'search_places',
    description:
      'Google Maps search near the user (SerpApi google_maps). Adds open places to CANDIDATES with rating, price and distance. Change query or radius_m to refine or widen.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Dish, cuisine or venue, e.g. "chicken biryani", "mandi".' },
        radius_m: { type: 'INTEGER', description: '1000, 2000, 5000 or 10000.' },
        open_now: { type: 'BOOLEAN', description: 'Default true.' },
        min_rating: { type: 'NUMBER', description: 'Optional, e.g. 4.0.' },
        why: WHY,
      },
      required: ['query', 'radius_m', 'why'],
    },
  },
  READ_REVIEWS,
  WEB_SEARCH,
  GET_DIRECTIONS,
  {
    name: 'finish',
    description: 'Final ranking, best first. Only places whose reviews you read.',
    parameters: {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING', description: 'Max 8 words: the finding.' },
        reason: { type: 'STRING', description: 'Max 24 words: what recent reviews say and what you checked.' },
        ranked: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              place_id: { type: 'STRING' },
              verdict: { type: 'STRING', description: 'Max 22 words from the reviews; say so if they never mention the dish.' },
              review_support: { type: 'INTEGER', description: '0-30: how strongly recent reviews back the craving and preferences.' },
              dishes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Up to 3 specific dishes reviewers speak well of here (e.g. "mutton biryani", "kunafa"). Never a dish they criticise, never generic words like meals or food. Empty if none.' },
            },
            required: ['place_id', 'verdict', 'review_support'],
          },
        },
      },
      required: ['headline', 'reason', 'ranked'],
    },
  },
];

export const FOLLOWUP_TOOLS: FunctionDeclaration[] = [
  READ_REVIEWS,
  WEB_SEARCH,
  GET_DIRECTIONS,
  {
    name: 'finish_answer',
    description: 'Reply to the user. Give place_id when the answer points at one place.',
    parameters: {
      type: 'OBJECT',
      properties: {
        answer: { type: 'STRING', description: 'The chat reply: 1-3 friendly sentences, max 70 words, naming places and what reviews say.' },
        headline: { type: 'STRING', description: 'Max 8 words, for the map card.' },
        reason: { type: 'STRING', description: 'Max 24 words: the evidence, not a formula.' },
        place_id: { type: 'STRING' },
        verdict: { type: 'STRING', description: 'Max 22 words about the chosen place.' },
      },
      required: ['answer', 'headline', 'reason'],
    },
  },
];

export const SEARCH_SYSTEM = `You are YumFindAI, a food-finding agent. You decide which Google data to pull through SerpApi tools, then rank open places only from evidence you read.

Plan in as few steps as possible (3-4 is typical; several tool calls in one step is good):
1. search_places for the craving at the user's radius.
2. read_reviews for the 4-5 most promising places at once (close, well rated, open).
3. Thin results (under 3 places) or reviews that never mention the dish: widen the radius (2 > 5 > 10 km), search the local name of the dish, or read_reviews more=true for strong candidates. A web_search for "best <dish> in <area>" can go in the same step.
4. get_directions only if the user wants quick, close or walking distance.
5. finish with 3-5 places as soon as you have review evidence. Spending budget is not a goal.
Stop rule: if two rounds of reading never mention the dish, finish with the best-reviewed places you read and say recent reviews don't mention it. Never search for one restaurant by name; at most 3 search_places calls.

Evidence:
- Never invent a place, rating, price, distance or review. Verdicts paraphrase reviews from the last 3 months; if none mention the dish, say "recent reviews don't mention <dish>".
- Weigh preferences and add-ons (veg, spicy, family, parking, outdoor seating, pure veg) by what reviews say.
- CANDIDATES in each tool result is your memory: ids, facts, reviews read, dish mentions, evidence quotes, budget left. Older tool results are shortened; trust CANDIDATES.

Style: "why" lines name the source ("Searching Google Maps for mandi within 5 km"). Verdict example: "Reviewers single out the mutton biryani as rich and well spiced; one found it oily."`;

export const FOLLOWUP_SYSTEM = `You are YumFindAI, chatting with the user about the places on their map. Answer from the evidence given; it holds their recent reviews.
Use a tool only when that evidence cannot answer: read_reviews more=true for deeper reviews, web_search for things reviews rarely cover, get_directions for drive time or which is closer by road.
The chat so far is listed; resolve "it", "that one" or "there" against it. Use what you remember about the user's taste when it matters, and say so.
Use web_search at most once per question; it is slow.
Then call finish_answer: a warm, specific reply in answer, plus place_id when it points at one place. Never invent facts: general knowledge about a cuisine is not evidence. If the reviews are silent, say so plainly.`;

export function searchTask(input: {
  craving: string;
  dish: string;
  where: string;
  radius: string;
  preferences: string[];
  addons: string[];
  wantsBest: boolean;
  memory: string[];
}) {
  return [
    `Craving: "${input.craving}" (search term "${input.dish}") near ${input.where}, radius ${input.radius}.`,
    `Preferences: ${input.preferences.join(', ') || 'none'}. Add-ons: ${input.addons.join(', ') || 'none'}.`,
    input.memory.length ? `You remember this user: ${input.memory.join('; ')}.` : '',
    input.wantsBest ? 'They asked for the best: prefer rating 4.0+.' : '',
    'Begin.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function followupTask(question: string, history: string[], memory: string[], places: unknown[]) {
  return [
    memory.length ? `You remember this user: ${memory.join('; ')}.` : '',
    history.length ? `Chat so far:\n${history.join('\n')}` : '',
    `Question: "${question}"`,
    `PLACES (with the most relevant recent reviews): ${JSON.stringify(places)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
