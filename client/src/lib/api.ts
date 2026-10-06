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
