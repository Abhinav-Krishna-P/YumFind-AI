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
  /** The reviewer, so their wider review history can be checked (Taste Twins). */
  reviewer?: Reviewer | null;
};

export type Reviewer = { id: string; name: string | null; photo: string | null; localGuide: boolean; reviewCount: number | null };

/** A reviewer whose food taste matches the user's, and what they said about this place. */
export type TasteTwin = {
  name: string;
  photo: string | null;
  localGuide: boolean;
  match: number;
  why: string;
  rating: number | null;
  said: string;
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
  /** Reviewers of this place who eat like the user. */
  twins?: TasteTwin[];
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
