import { MapCanvas, type RoutePoint } from '@/components/MapCanvas';
import { PopIn } from '@/components/bits/PopIn';
import { Button } from '@/components/ui/button';
import { api, type Place } from '@/lib/api';
import { distanceLabel, rupees } from '@/lib/utils';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

type Phase = 'idle' | 'locating' | 'located' | 'craving' | 'constraints' | 'searching' | 'ranking' | 'place' | 'error';
type Tone = 'positive' | 'neutral' | 'negative';

const RADII = [
  { id: 1000, label: '1 km' },
  { id: 2000, label: '2 km' },
  { id: 5000, label: '5 km' },
  { id: 10000, label: '10 km' },
];
const PREFS = ['veg', 'spicy', 'family', 'quick bite'];
const ADDONS = ['parking', 'outdoor seating', 'pure veg kitchen'];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function Dashboard() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [dropMode, setDropMode] = useState(false);
  const [user, setUser] = useState<{ lat: number; lng: number } | null>(null);
  const [ranked, setRanked] = useState<Place[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [craving, setCraving] = useState('');
  const [radius, setRadius] = useState(2000);
  const [prefs, setPrefs] = useState<string[]>([]);
  const [addons, setAddons] = useState<string[]>([]);
  const [headline, setHeadline] = useState('');
  const [reason, setReason] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [follow, setFollow] = useState('');
  const [followOpen, setFollowOpen] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState<{ path: RoutePoint[]; distance: string | null; duration: string | null } | null>(null);
  const [routeNote, setRouteNote] = useState('');

  const selected = ranked.find((place) => place.id === selectedId) || null;
  const showPlaces = phase === 'ranking' || phase === 'place' || (phase === 'searching' && ranked.length > 0);
  const mapPlaces = useMemo(
    () =>
      (showPlaces ? ranked : []).map((place) => ({
        id: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        selected: place.id === selectedId,
      })),
    [ranked, selectedId, showPlaces],
  );

  function placeUser(lat: number, lng: number) {
    setUser({ lat, lng });
    setDropMode(false);
    setRanked([]);
    setSelectedId(null);
    setRoute(null);
    setRouteNote('');
    setHeadline('You are here');
    setReason('Search for a dish. Nearby restaurants stay hidden until you do.');
    setPhase('located');
  }

  function locate() {
    setPhase('locating');
    if (!navigator.geolocation) {
      setDropMode(true);
      setError('Location is unavailable. Drop a pin on the map.');
      setPhase('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => placeUser(position.coords.latitude, position.coords.longitude),
      () => {
        setDropMode(true);
        setError('Location was blocked. Drop a pin on the map.');
        setPhase('error');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function infer(text: string) {
    const radiusMatch = text.match(/(\d+)\s*km/i);
    const found = RADII.find((item) => item.id === Number(radiusMatch?.[1] || 0) * 1000);
    if (found) setRadius(found.id);
    const nextPrefs = PREFS.filter((item) => new RegExp(item, 'i').test(text));
    const nextAddons = ADDONS.filter((item) => new RegExp(item, 'i').test(text));
    if (nextPrefs.length) setPrefs(nextPrefs);
    if (nextAddons.length) setAddons(nextAddons);
  }

  async function search() {
    if (!user) return;
    setPhase('searching');
    try {
      const result = await api<{
        fingerprint: string;
        headline: string;
        reason: string;
        places: Place[];
      }>('/api/search', {
        craving,
        lat: user.lat,
        lng: user.lng,
        radiusM: radius,
        preferences: prefs,
        addons,
      });
      setFingerprint(result.fingerprint);
      setHeadline(result.headline);
      setReason(result.reason);
      setRanked(result.places);
      setSelectedId(null);
      setRoute(null);
      setRouteNote('');
      setPhase('ranking');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search is unavailable');
      setPhase('error');
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!follow.trim() || !fingerprint) return;
    const question = follow.trim();
    setFollow('');
    setFollowOpen(false);
    try {
      const result = await api<{ headline: string; reason: string; placeId: string | null; verdict: string | null }>(
        '/api/followup',
        { fingerprint, question },
      );
      setHeadline(result.headline);
      setReason(result.reason);
      if (result.placeId) {
        setSelectedId(result.placeId);
        setRanked((current) =>
          current.map((place) => (place.id === result.placeId && result.verdict ? { ...place, verdict: result.verdict } : place)),
        );
        setPhase('place');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search is unavailable');
      setPhase('error');
    }
  }

  function openPlace(id: string) {
    const place = ranked.find((item) => item.id === id);
    setSelectedId(id);
    setPhase('place');
    setRoute(null);
    setRouteNote(user && place ? 'Finding the driving route...' : '');
    if (user && place) {
      void api<{ path: RoutePoint[]; distance: string | null; duration: string | null }>('/api/directions', {
        startLat: user.lat,
        startLng: user.lng,
        endLat: place.lat,
        endLng: place.lng,
      })
        .then((result) => {
          setRoute(result);
          setRouteNote([result.duration, result.distance].filter(Boolean).join(' · ') || 'Route ready');
        })
        .catch(() => {
          setRoute(null);
          setRouteNote('Route is unavailable');
        });
    }
    void api('/api/visits', { placeId: id }).catch(() => undefined);
  }

  function closePlace() {
    setPhase('ranking');
    setSelectedId(null);
    setRoute(null);
    setRouteNote('');
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-zinc-100">
      <MapCanvas
        user={user}
        places={mapPlaces}
        route={route?.path || []}
        dropMode={dropMode}
        onDrop={placeUser}
        onSelect={openPlace}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
        <Link className="pointer-events-auto rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold shadow-sm" to="/">
          YumFindAI
        </Link>
        <Link className="pointer-events-auto rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm" to="/profile">
          Profile
        </Link>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center overflow-hidden p-4">
        {phase === 'idle' ? (
          <PopIn className="pointer-events-auto w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-lg">
            <h1 className="text-xl font-semibold">Locate yourself</h1>
            <p className="mt-1 text-sm text-zinc-500">Only your position is shown until you search.</p>
            <Button className="mt-4" onClick={locate}>
              Locate me
            </Button>
          </PopIn>
        ) : null}

        {phase === 'locating' ? (
          <PopIn className="pointer-events-auto rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm shadow-sm">
            Finding your location...
          </PopIn>
        ) : null}

        {phase === 'located' || phase === 'craving' ? (
          <PopIn className="pointer-events-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <p className="text-sm font-medium">{headline}</p>
            <p className="mt-1 text-sm text-zinc-500">{reason}</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!craving.trim()) return;
                void (async () => {
                  try {
                    await api('/api/topic', { text: craving, mode: 'search' });
                    infer(craving);
                    setPhase('constraints');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'YumFindAI only answers food, restaurant, and hotel questions');
                    setPhase('error');
                  }
                })();
              }}
            >
              <input
                className="h-10 flex-1 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                placeholder="Biryani, cafe, or hotel"
                value={craving}
                onChange={(event) => setCraving(event.target.value)}
              />
              <Mic onText={setCraving} />
              <Button type="submit">Search</Button>
            </form>
            <p className="mt-2 text-xs text-zinc-400">Food, restaurants, and hotels only.</p>
          </PopIn>
        ) : null}

        {phase === 'constraints' ? (
          <PopIn className="pointer-events-auto max-h-[46vh] w-full max-w-lg overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <p className="text-sm font-medium">Radius and preferences</p>
            <ChipRow options={RADII.map((item) => item.label)} active={RADII.find((item) => item.id === radius)?.label || ''} onPick={(label) => setRadius(RADII.find((item) => item.label === label)?.id || 2000)} />
            <ChipRow options={PREFS} active={prefs} onPick={(value) => setPrefs((current) => toggle(current, value))} />
            <ChipRow options={ADDONS} active={addons} onPick={(value) => setAddons((current) => toggle(current, value))} />
            <Button className="mt-3" onClick={() => void search()}>
              Read reviews
            </Button>
          </PopIn>
        ) : null}

        {phase === 'searching' ? (
          <PopIn className="pointer-events-auto rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm shadow-sm">
            Reading recent reviews...
          </PopIn>
        ) : null}

        {phase === 'ranking' ? (
          <div className="pointer-events-auto w-full min-w-0 overflow-hidden rounded-2xl bg-white p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-3">
              <ReviewReport places={ranked} />
              {followOpen ? (
                <form className="flex shrink-0 gap-2" onSubmit={ask}>
                  <input className="h-9 w-44 rounded-lg border border-zinc-300 bg-white px-3 text-sm" value={follow} onChange={(event) => setFollow(event.target.value)} placeholder="Which is less spicy?" />
                  <Button type="submit">Ask</Button>
                </form>
              ) : (
                <button className="shrink-0 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium" type="button" onClick={() => setFollowOpen(true)}>
                  Ask about these
                </button>
              )}
            </div>
            <ResultCarousel places={ranked} onOpen={openPlace} />
          </div>
        ) : null}

        {phase === 'place' && selected ? <PlaceCard place={selected} routeNote={routeNote} onClose={closePlace} /> : null}

        {phase === 'error' ? (
          <PopIn className="pointer-events-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
            <p className="text-sm">{error}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={locate}>Try locate</Button>
              <Button variant="outline" onClick={() => setPhase(user ? 'located' : 'idle')}>
                Back to map
              </Button>
            </div>
          </PopIn>
        ) : null}
      </div>
    </main>
  );
}

function ReviewReport({ places }: { places: Place[] }) {
  const totals = places.reduce(
    (sum, place) => {
      const tone = sentimentOf(place);
      sum.positive += tone.positive;
      sum.neutral += tone.neutral;
      sum.negative += tone.negative;
      return sum;
    },
    { positive: 0, neutral: 0, negative: 0 },
  );
  const read = totals.positive + totals.neutral + totals.negative;
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-zinc-900">Review report</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
        <span>{read ? `${read} reviews, last 3 months` : 'No recent reviews'}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{totals.positive} positive</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{totals.neutral} neutral</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{totals.negative} negative</span>
      </div>
    </div>
  );
}

function ResultCarousel({ places, onOpen }: { places: Place[]; onOpen: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);

  function move(direction: number) {
    const node = scroller.current;
    if (!node) return;
    const card = node.querySelector<HTMLElement>('[data-card]');
    const distance = card ? card.offsetWidth + 12 : 300;
    node.scrollBy({ left: direction * distance, behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <CarouselButton label="Previous restaurants" side="left" onClick={() => move(-1)} />
      <div
        ref={scroller}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {places.map((place) => (
          <ResultCard key={place.id} place={place} onOpen={() => onOpen(place.id)} />
        ))}
      </div>
      <CarouselButton label="Next restaurants" side="right" onClick={() => move(1)} />
    </div>
  );
}

function CarouselButton({ label, side, onClick }: { label: string; side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      className={`absolute top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-zinc-200 bg-white text-lg text-zinc-900 shadow-md ${side === 'left' ? 'left-0' : 'right-0'}`}
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}

function ResultCard({ place, onOpen }: { place: Place; onOpen: () => void }) {
  const counts = sentimentOf(place);
  const latest = place.latestReview || place.reviews?.[0] || null;
  const review = latest?.snippet || '';
  const [expanded, setExpanded] = useState(false);
  const canExpand = review.length > 70;
  return (
    <div data-card className="flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left">
      <button className="text-left" type="button" onClick={onOpen}>
        <PlacePhoto src={place.thumbnail} className="h-16 w-full" />
        <div className="px-2 pt-2">
          <h2 className="truncate text-xs font-semibold">{place.name}</h2>
          <p className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
            <Stars rating={place.rating} />
            <span>{distanceLabel(place.distanceM)}</span>
          </p>
          <p className={`mt-1 text-[11px] leading-4 text-zinc-700 ${expanded ? '' : 'line-clamp-2'}`}>{review || 'No recent review'}</p>
        </div>
      </button>
      {canExpand ? (
        <button
          className="px-2 pt-1 text-left text-[10px] font-medium text-zinc-900"
          type="button"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
      <div className="mt-1 flex items-center justify-between px-2 text-[10px] text-zinc-600">
        <span>{counts.positive} positive</span>
        <span>{counts.negative} negative</span>
      </div>
      <p className="px-2 pb-2 pt-0.5 text-[10px] text-zinc-400">Last 3 months</p>
    </div>
  );
}

function PlacePhoto({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`${className} grid shrink-0 place-items-center bg-zinc-100 text-xs text-zinc-400`}>No photo</div>;
  }
  return (
    <img
      className={`${className} shrink-0 bg-zinc-100 object-cover`}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function sentimentOf(place: Place) {
  if (place.sentiment) return place.sentiment;
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const review of place.reviews || []) {
    const tone = toneOf(review.rating);
    if (tone) counts[tone] += 1;
  }
  return counts;
}

function toneOf(rating: number | null): Tone | null {
  if (rating == null) return null;
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

function Stars({ rating }: { rating: number | null }) {
  const score = rating == null ? 0 : Math.max(0, Math.min(5, rating));
  return (
    <span className="relative inline-block whitespace-nowrap text-[12px] leading-none tracking-tight text-zinc-300" aria-label={rating == null ? 'No rating' : `${rating} stars`}>
      ★★★★★
      <span className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-zinc-900" style={{ width: `${(score / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

function PlaceCard({ place, routeNote, onClose }: { place: Place; routeNote: string; onClose: () => void }) {
  const reviews = place.reviews || [];
  const counts = sentimentOf(place);
  return (
    <PopIn className="pointer-events-auto relative max-h-[58vh] w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
      <button
        className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm"
        type="button"
        aria-label="Back to results"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="max-h-[58vh] overflow-auto">
      <PlacePhoto src={place.thumbnail} className="h-24 w-full" />
      <div className="p-4">
        <p className="text-xs font-medium text-zinc-500">Review report</p>
        <h2 className="text-lg font-semibold">{place.name}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
          <Stars rating={place.rating} />
          <span>
            {[place.reviewsCount != null ? `${place.reviewsCount} Google reviews` : null, rupees(place.priceLevel), distanceLabel(place.distanceM), place.openNow ? 'Open' : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </p>
        {routeNote ? <p className="mt-2 text-sm font-medium">{routeNote}</p> : null}
        {place.address ? <p className="mt-1 text-sm text-zinc-500">{place.address}</p> : null}
        <p className="mt-2 text-sm text-zinc-600">
          Read {counts.positive + counts.neutral + counts.negative} reviews from the last 3 months.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <ToneStat label="Positive" value={counts.positive} />
          <ToneStat label="Neutral" value={counts.neutral} />
          <ToneStat label="Negative" value={counts.negative} />
        </div>
        <div className="mt-4 space-y-4">
          {reviews.length === 0 ? <p className="text-sm text-zinc-500">No recent reviews stored.</p> : null}
          <ReviewGroup label="Positive" reviews={reviews.filter((review) => toneOf(review.rating) === 'positive')} />
          <ReviewGroup label="Neutral" reviews={reviews.filter((review) => toneOf(review.rating) === 'neutral')} />
          <ReviewGroup label="Negative" reviews={reviews.filter((review) => toneOf(review.rating) === 'negative')} />
        </div>
      </div>
      </div>
    </PopIn>
  );
}

function ReviewGroup({
  label,
  reviews,
}: {
  label: string;
  reviews: { author: string | null; rating: number | null; snippet: string; publishedAt: string }[];
}) {
  if (!reviews.length) return null;
  return (
    <section>
      <h3 className="text-xs font-medium text-zinc-500">{label}</h3>
      <ul className="mt-1 space-y-2">
        {reviews.map((review) => (
          <li key={review.publishedAt + review.snippet} className="text-sm text-zinc-800">
            <span className="text-xs text-zinc-500">{review.author || 'Guest'}{review.rating != null ? ` · ${review.rating}` : ''}</span>
            <p>{review.snippet}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ToneStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-zinc-500">{label}</div>
    </div>
  );
}

function ChipRow({
  options,
  active,
  onPick,
}: {
  options: string[];
  active: string | string[];
  onPick: (value: string) => void;
}) {
  const chosen = Array.isArray(active) ? active : [active];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`rounded-full border px-3 py-1 text-sm ${chosen.includes(option) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}
          onClick={() => onPick(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Mic({ onText }: { onText: (value: string) => void }) {
  const supported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  if (!supported) return null;
  return (
    <button
      className="rounded-lg border border-zinc-300 bg-white px-3 text-sm"
      type="button"
      onClick={() => {
        const win = window as Window & {
          SpeechRecognition?: new () => SpeechHandle;
          webkitSpeechRecognition?: new () => SpeechHandle;
        };
        const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!Ctor) return;
        const rec = new Ctor();
        rec.lang = 'en-IN';
        rec.onresult = (event) => onText(event.results[0][0].transcript);
        rec.start();
      }}
    >
      Mic
    </button>
  );
}

type SpeechHandle = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start: () => void;
};
