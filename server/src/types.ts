export type Budget = '₹' | '₹₹' | '₹₹₹' | '₹₹₹₹';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Review = {
  sourceId: string;
  author: string | null;
  rating: number | null;
  snippet: string;
  publishedAt: string;
};

export type Points = {
  total: number;
  distance: number;
  rating: number;
  price: number;
  reviews: number;
  source: 'jev' | 'gemini' | 'fallback';
};

export type Evidence = {
  text: string;
  publishedAt: string;
};

export type Place = {
  id: string;
  dataId: string;
  googlePlaceId: string | null;
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
  hours: Record<string, string> | null;
  distanceM: number | null;
  reviews: Review[];
  points: Points | null;
  verdict: string | null;
  evidence: Evidence[];
  /** Dishes recent reviews praise here, named by the agent and checked against the reviews. */
  dishes: string[];
};

export type TraceStep = { tool: string; say: string; summary: string };

export type Snapshot = {
  fingerprint: string;
  headline: string;
  reason: string;
  places: Place[];
  expiresAt: number;
  trace?: TraceStep[];
};

export type Actor = {
  userId: string;
  jwt: string;
};
