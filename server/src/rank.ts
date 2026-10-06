import type { Place, Points } from './types.js';

export function distanceUnit(meters: number, radius: number) {
  if (meters <= 500) return 100;
  if (radius <= 500) return meters <= radius ? 100 : 0;
  if (meters >= radius) return 0;
  return 100 * (1 - (meters - 500) / (radius - 500));
}

export function preScore(
  place: { distanceM: number; rating: number | null },
  radius: number,
) {
  const distance = distanceUnit(place.distanceM, radius);
  const rating = place.rating == null ? 50 : (place.rating / 5) * 100;
  return distance * 0.6 + rating * 0.4;
}

function roundParts(parts: Omit<Points, 'total'>): Points {
  const distance = Math.round(parts.distance);
  const rating = Math.round(parts.rating);
  const price = Math.round(parts.price);
  const rawReviews = Math.round(parts.reviews);
  const target = Math.round(parts.distance + parts.rating + parts.price + parts.reviews);
  const reviews = rawReviews + (target - (distance + rating + price + rawReviews));
  return {
    distance,
    rating,
    price,
    reviews,
    total: distance + rating + price + reviews,
    source: parts.source,
  };
}

export function fallbackPoints(place: Place, radius: number): Points {
  const meters = place.distanceM ?? radius;
  return roundParts({
    distance: (distanceUnit(meters, radius) / 100) * 30,
    rating: ((place.rating == null ? 50 : (place.rating / 5) * 100) / 100) * 25,
    price: 8,
    reviews: 15,
    source: 'fallback',
  });
}

export function pointsFromRubric(scores: {
  distance: number;
  rating: number;
  price: number;
  reviews: number;
}): Points {
  const unit = (score: number, max: number) => (Math.min(4, Math.max(0, score)) / 4) * max;
  return roundParts({
    distance: unit(scores.distance, 30),
    rating: unit(scores.rating, 25),
    price: unit(scores.price, 15),
    reviews: unit(scores.reviews, 30),
    source: 'jev',
  });
}

export function sortPlaces(places: Place[]) {
  return [...places].sort((a, b) => {
    const score = (b.points?.total ?? 0) - (a.points?.total ?? 0);
    if (score) return score;
    const distance = (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY);
    if (distance) return distance;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}
