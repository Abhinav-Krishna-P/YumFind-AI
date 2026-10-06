// Paused: Jev is a paid decision API. Ranking uses Gemini until this file is wired back in from pipeline.ts.
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import * as ai from 'ai';
import { env } from './env.js';
import { pointsFromRubric } from './rank.js';
import type { Budget, Place, Points } from './types.js';

type Answer = { score?: number; choice?: string };
type Decision = {
  answers?: Record<string, Answer>;
};

const decide =
  (ai as { experimental_decide?: (input: unknown) => Promise<Decision> }).experimental_decide ||
  (ai as { experimental_evaluate?: (input: unknown) => Promise<Decision> }).experimental_evaluate;

const RUBRIC = ['Poor fit', 'Weak fit', 'Mixed', 'Good fit', 'Excellent fit'];

function snippet(place: Place) {
  return place.reviews
    .slice(0, 4)
    .map((review) => review.snippet)
    .join(' | ')
    .slice(0, 700);
}

export async function scoreWithJev(
  places: Place[],
  input: { craving: string; radiusM: number; budget: Budget; preferences: string[]; addons: string[] },
): Promise<Map<string, Points> | null> {
  if (!env.jev || !decide || places.length === 0) return null;
  const typesafe = createTypeSafeAi({ apiKey: env.jev });
  const questions: Record<string, unknown> = {};
  places.forEach((place, index) => {
    const facts = `Place ${index}: ${place.name}. Distance ${Math.round(place.distanceM ?? 0)}m. Google rating ${place.rating ?? 'unknown'}. Price level ${place.priceLevel ?? 'unknown'}. Recent reviews: ${snippet(place) || 'none'}.`;
    questions[`d${index}`] = {
      type: 'score',
      instructions: `${facts} Score closeness for a ${input.radiusM}m search. 500m or less is excellent.`,
      criteria: RUBRIC,
    };
    questions[`r${index}`] = {
      type: 'score',
      instructions: `${facts} Score the Google rating. Missing rating is mixed, not poor.`,
      criteria: RUBRIC,
    };
    questions[`p${index}`] = {
      type: 'score',
      instructions: `${facts} Score price fit for budget ${input.budget}. Missing price is mixed.`,
      criteria: RUBRIC,
    };
    questions[`v${index}`] = {
      type: 'score',
      instructions: `${facts} Score how strongly the last six months of reviews support "${input.craving}" and preferences ${input.preferences.join(', ') || 'none'}. No mention of the dish is a weak fit.`,
      criteria: RUBRIC,
    };
  });
  questions.best = {
    type: 'choice',
    instructions:
      'Which place index should rank first for this craving? Use distance, rating, price, and recent reviews. Do not prefer a place the reviews do not support.',
    criteria: Object.fromEntries(places.map((place, index) => [String(index), place.name])),
  };

  const result = await decide({
    model: typesafe.decisionModel(env.jevModel),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(4000),
    state: {
      craving: input.craving,
      radiusM: input.radiusM,
      budget: input.budget,
      preferences: input.preferences,
      addons: input.addons,
      places: places.map((place, index) => ({
        index,
        name: place.name,
        distanceM: place.distanceM,
        rating: place.rating,
        priceLevel: place.priceLevel,
        reviews: place.reviews.slice(0, 4).map((review) => review.snippet),
      })),
    },
    questions,
  });

  const answers = result.answers || {};
  const scores = new Map<string, Points>();
  places.forEach((place, index) => {
    const distance = answers[`d${index}`]?.score;
    const rating = answers[`r${index}`]?.score;
    const price = answers[`p${index}`]?.score;
    const reviews = answers[`v${index}`]?.score;
    if (
      typeof distance !== 'number' ||
      typeof rating !== 'number' ||
      typeof price !== 'number' ||
      typeof reviews !== 'number'
    ) {
      throw new Error('Jev returned an incomplete score');
    }
    scores.set(place.dataId, pointsFromRubric({ distance, rating, price, reviews }));
  });

  const best = Number(answers.best?.choice);
  if (Number.isInteger(best) && places[best]) {
    const ranked = places.map((place) => scores.get(place.dataId)?.total ?? 0);
    const leader = Math.max(...ranked);
    const chosen = scores.get(places[best].dataId);
    if (chosen && chosen.total < leader && leader - chosen.total <= 2) {
      const bump = leader + 1 - chosen.total;
      chosen.reviews += bump;
      chosen.total += bump;
    }
  }
  return scores;
}

export async function chooseFollowUp(places: Place[], question: string) {
  if (!env.jev || !decide || places.length === 0) return null;
  const typesafe = createTypeSafeAi({ apiKey: env.jev });
  const result = await decide({
    model: typesafe.decisionModel(env.jevModel),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(3000),
    state: {
      question,
      places: places.map((place, index) => ({
        index,
        name: place.name,
        reviews: place.reviews.slice(0, 4).map((review) => review.snippet),
      })),
    },
    questions: {
      pick: {
        type: 'choice',
        instructions: `Which place index best answers the question "${question}"? Use only the stored review snippets. If none answer it, still pick the closest weak match.`,
        criteria: Object.fromEntries(places.map((place, index) => [String(index), place.name])),
      },
    },
  });
  const pick = Number(result.answers?.pick?.choice);
  return Number.isInteger(pick) ? places[pick]?.id ?? null : null;
}
