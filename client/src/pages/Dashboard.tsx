import { MapCanvas, type RoutePoint } from '@/components/MapCanvas';
import { CATEGORIES, Logo, Photo, useTitle } from '@/components/brand';
import { LogoMark, Mascot, useInputGaze } from '@/components/mascot/Mascot';
import { AgentTrace, agentMood } from '@/components/AgentTrace';
import { ChatPanel, type ChatAnswer } from '@/components/ChatPanel';
import { SnapButton, type SnapState } from '@/components/SnapButton';
import { MenuSection } from '@/components/MenuSection';
import { api, apiStream, upsertStep, type AgentStep, type Place, type RunUsage, type TasteTwin, type TraceStep } from '@/lib/api';
import { useSession } from '@/lib/session';
import { readSpot, saveSpot } from '@/lib/spot';
import { estimateDriveMin, parseDuration, timing, type Timing } from '@/lib/hours';
import { distanceLabel, rupees } from '@/lib/utils';
import { BadgeCheck, BookOpen, Camera, Clock, ChevronDown, Heart, ChevronLeft, ChevronRight, ChevronUp, LocateFixed, MapPin, MessageCircle, Mic as MicIcon, Navigation, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

type Phase = 'idle' | 'locating' | 'located' | 'craving' | 'constraints' | 'searching' | 'ranking' | 'place' | 'error';
type Tone = 'positive' | 'neutral' | 'negative';
type Review = { author: string | null; rating: number | null; snippet: string; publishedAt: string };

const RADII = [
  { id: 1000, label: '1 km' },
  { id: 2000, label: '2 km' },
  { id: 5000, label: '5 km' },
  { id: 10000, label: '10 km' },
];
const PREFS = ['veg', 'spicy', 'family', 'quick bite'];
const ADDONS = ['parking', 'outdoor seating', 'pure veg kitchen'];
const AVATAR_BG = ['#ffe0a3', '#ffd0c7', '#d6f0df', '#dfe7ff', '#f6dcff'];
const TONES = {
  positive: { label: 'Positive', dot: '#1fa45a', bg: '#e6f6ed', fg: '#137a41' },
  neutral: { label: 'Neutral', dot: '#a19ca6', bg: '#f3f1f4', fg: '#4a4650' },
  negative: { label: 'Negative', dot: '#ff3d54', bg: '#ffeceb', fg: '#c4222d' },
} as const;

/** True for `ms` after the value changes to something truthy; used for short mascot reactions. */
function useBeat(value: unknown, ms: number) {
  const [on, setOn] = useState(() => Boolean(value));
  useEffect(() => {
    if (!value) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return on;
}

function addUsage(a: RunUsage | null, b: RunUsage | undefined): RunUsage | null {
  if (!b) return a;
  if (!a) return b;
  return {
    cacheHit: a.cacheHit && b.cacheHit,
    turns: a.turns + b.turns,
    serpCalls: a.serpCalls + b.serpCalls,
    promptTokens: a.promptTokens + b.promptTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
  };
}

/** "9 SerpApi calls · 14.2k tokens", or a note that the answer came from memory. */
function costLabel(usage: RunUsage | null) {
  if (!usage) return null;
  if (usage.cacheHit) return 'from memory, no new SerpApi calls';
  const tokens = usage.promptTokens + usage.outputTokens + usage.thinkingTokens;
  const shown = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  return `${usage.serpCalls} SerpApi call${usage.serpCalls === 1 ? '' : 's'} · ${shown} tokens`;
}

const NO_ROUTE: RoutePoint[] = [];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function Dashboard() {
  const navigate = useNavigate();
  const { initial } = useSession();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('idle');
  const [dropMode, setDropMode] = useState(false);
  const [user, setUser] = useState<{ lat: number; lng: number } | null>(null);
  const [ranked, setRanked] = useState<Place[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [craving, setCraving] = useState(() => params.get('q') || '');
  const [radius, setRadius] = useState(2000);
  const [prefs, setPrefs] = useState<string[]>([]);
  const [addons, setAddons] = useState<string[]>([]);
  const [headline, setHeadline] = useState('');
  const [reason, setReason] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  // Bumped to cancel in-flight work: a newer search or place supersedes an older reply.
  const searchRun = useRef(0);
  const placeRun = useRef(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState<{ path: RoutePoint[]; distance: string | null; duration: string | null } | null>(null);
  const [routeNote, setRouteNote] = useState('');
  const [placeLabel, setPlaceLabel] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [usage, setUsage] = useState<RunUsage | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [listening, setListening] = useState(false);
  const [snap, setSnap] = useState<SnapState>({ status: 'idle' });
  const [resultsAt, setResultsAt] = useState(0);
  const [chipAt, setChipAt] = useState(0);
  const greeting = useBeat(1, 2600);
  const celebrating = useBeat(resultsAt, 2600);
  const chipCheer = useBeat(chipAt, 700);
  const cravingGaze = useInputGaze();
  useTitle('Map');

  useEffect(() => {
    if (!user) return;
    let live = true;
    setPlaceLabel('');
    api<{ label: string | null }>('/api/where', user)
      .then((result) => {
        if (!live) return;
        setPlaceLabel(result.label || 'Your location');
        saveSpot({ ...user, label: result.label });
      })
      .catch(() => live && setPlaceLabel('Your location'));
    return () => {
      live = false;
    };
  }, [user]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (params.get('pin') === '1') {
      setDropMode(true);
      return;
    }
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    const handedOver = params.has('lat') && params.has('lng') && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const start = handedOver ? { lat, lng } : readSpot();
    if (!start) return;
    placeUser(start.lat, start.lng);
    const q = params.get('q')?.trim();
    if (q) void advance(q);
    // Runs once with the URL the map was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = ranked.find((place) => place.id === selectedId) || null;
  const showPlaces = phase === 'ranking' || phase === 'place' || (phase === 'searching' && ranked.length > 0);
  const mapPlaces = useMemo(
    () =>
      (showPlaces ? ranked : []).map((place, index) => ({
        id: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        rank: index + 1,
        rating: place.rating,
        thumbnail: place.thumbnail,
        selected: place.id === selectedId,
      })),
    [ranked, selectedId, showPlaces],
  );

  function placeUser(lat: number, lng: number) {
    searchRun.current += 1;
    placeRun.current += 1;
    setFingerprint('');
    setChatOpen(false);
    saveSpot({ lat, lng, label: null });
    setUser({ lat, lng });
    setDropMode(false);
    setRanked([]);
    setSelectedId(null);
    setRoute(null);
    setRouteNote('');
    setHeadline('You are here');
    setReason("Tell me what you're craving and how you like it. I'll match places to your taste.");
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
        setDropMode(!user);
        setError(user ? "Couldn't update your location, so your current spot is kept." : 'Location was blocked. Drop a pin on the map.');
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

  async function submitCraving(event: FormEvent) {
    event.preventDefault();
    await advance(craving);
  }

  async function advance(text: string) {
    if (!text.trim()) return;
    try {
      await api('/api/topic', { text, mode: 'search' });
      infer(text);
      setPhase('constraints');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YumFindAI only answers food, restaurant, and hotel questions');
      setPhase('error');
    }
  }

  async function search() {
    if (!user) return;
    const run = ++searchRun.current;
    placeRun.current += 1;
    setFingerprint('');
    setPhase('searching');
    setSteps([]);
    setTrace([]);
    setShowTrace(false);
    setChatOpen(false);
    setRanked([]);
    setSelectedId(null);
    setRoute(null);
    setRouteNote('');
    try {
      const result = await apiStream<{
        fingerprint: string;
        headline: string;
        reason: string;
        places: Place[];
        trace: TraceStep[];
        usage?: RunUsage;
      }>(
        '/api/agent/search',
        { craving, lat: user.lat, lng: user.lng, radiusM: radius, preferences: prefs, addons, locationLabel: placeLabel || undefined },
        (event) => {
          if (run !== searchRun.current) return;
          if (event.type === 'step') setSteps((current) => upsertStep(current, event));
          // Candidates drop onto the map as the agent finds them, before the ranking is final.
          if (event.type === 'places') setRanked(event.places);
        },
      );
      if (run !== searchRun.current) return;
      setFingerprint(result.fingerprint);
      setSelectedId(null);
      setHeadline(result.headline);
      setReason(result.reason);
      setRanked(result.places);
      setTrace(result.trace || []);
      setUsage(result.usage ?? null);
      setPhase('ranking');
      setResultsAt(Date.now());
    } catch (err) {
      if (run !== searchRun.current) return;
      setError(err instanceof Error ? err.message : 'Search is unavailable');
      setPhase('error');
    }
  }

  // A chat answer feeds the same trace, cost and verdicts as the search itself.
  function onChatAnswer(result: ChatAnswer) {
    if (result.trace?.length) setTrace((current) => [...current, ...result.trace]);
    setUsage((current) => addUsage(current, result.usage));
    if (result.placeId && result.verdict) {
      setRanked((current) => current.map((place) => (place.id === result.placeId ? { ...place, verdict: result.verdict } : place)));
    }
  }

  function showFromChat(id: string) {
    openPlace(id);
    // On a phone the chat covers the place card, so step aside; the chat is saved and reopens as it was.
    if (window.matchMedia('(max-width: 767px)').matches) setChatOpen(false);
  }

  function openPlace(id: string) {
    const run = ++placeRun.current;
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
          if (run !== placeRun.current) return;
          setRoute(result);
          setRouteNote([result.duration, result.distance].filter(Boolean).join(' · ') || 'Route ready');
        })
        .catch(() => {
          if (run !== placeRun.current) return;
          setRoute(null);
          setRouteNote('Route is unavailable');
        });
    }
    void api('/api/visits', { placeId: id }).catch(() => undefined);
  }

  function closePlace() {
    placeRun.current += 1;
    setPhase('ranking');
    setSelectedId(null);
    setRoute(null);
    setRouteNote('');
  }

  const chatVisible = chatOpen && Boolean(fingerprint) && (phase === 'ranking' || phase === 'place');

  return (
    <main className={`relative h-dvh overflow-hidden bg-[#f3f1f4]${chatVisible ? ' chat-open' : ''}`}>
      <MapCanvas
        user={user}
        places={mapPlaces}
        route={route?.path ?? NO_ROUTE}
        dropMode={dropMode}
        onDrop={placeUser}
        onSelect={(id) => (phase === 'ranking' || phase === 'place' ? openPlace(id) : undefined)}
      />
      <header
        className="absolute left-4 right-4 top-4 z-20 flex items-center gap-3 rounded-[20px] bg-white/[.92] py-2.5 pl-3.5 pr-2.5 backdrop-blur-[12px]"
        style={{ boxShadow: '0 12px 32px rgba(28,26,31,.12)', animation: 'fadeUp .5s ease backwards' }}
      >
        <Logo size={34} text={20} />
        <div className="flex min-w-0 flex-col border-l-[1.5px] border-line pl-3.5 leading-tight">
          <span className="text-[11px] font-semibold text-faint">Current location</span>
          <span className="flex items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold">
            <MapPin className="flex-none text-tomato" size={13} strokeWidth={2.75} />
            {user ? placeLabel || 'Locating...' : dropMode ? 'Tap the map to set' : 'Not set yet'}
          </span>
        </div>
        {user ? (
          <button
            type="button"
            onClick={locate}
            aria-label="Locate me again"
            title="Locate me again"
            className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full border-none bg-transparent text-muted hover:bg-mist hover:text-tomato"
          >
            <LocateFixed size={17} strokeWidth={2.5} />
          </button>
        ) : null}
        <button
          onClick={() => navigate('/profile')}
          aria-label="Profile"
          className="ml-auto h-10 w-10 flex-none cursor-pointer rounded-full border-none font-display text-[17px] font-bold text-ink transition-[translate,transform] duration-300 hover:scale-[1.08]"
          style={{ background: 'var(--grad-coin)' }}
        >
          {initial}
        </button>
      </header>

      <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4${chatVisible ? ' md:pr-[432px]' : ''}`}>
        {phase === 'idle' ? (
          <div className="sheet max-w-[440px] overflow-hidden">
            <div className="relative flex h-[136px] items-end justify-center overflow-hidden" style={{ background: 'linear-gradient(150deg,#ffd75e,#ffa91f)' }}>
              <div className="dot-grid absolute inset-0 opacity-80" />
              <Mascot mood={greeting ? 'wave' : dropMode ? 'curious' : 'idle'} size={126} follow className="relative -mb-1" />
            </div>
            <div className="px-[22px] pb-[22px] pt-5">
              <h1 className="m-0 font-display text-[26px] font-semibold">{dropMode ? 'Drop a pin' : 'Locate yourself'}</h1>
              <p className="mb-0 mt-1 text-sm text-muted">
                {dropMode ? 'Tap anywhere on the map to set where you are.' : 'YumFindAI only shows your position until you search.'}
              </p>
              <button onClick={locate} className={`${dropMode ? 'btn-outline' : 'btn-primary'} mt-4 h-[52px] w-full text-base`}>
                <LocateFixed size={18} strokeWidth={2.5} />
                {dropMode ? 'Use my location instead' : 'Locate me'}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'locating' ? (
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-white px-[22px] py-3.5 text-[15px] font-bold"
            style={{ boxShadow: '0 18px 44px rgba(28,26,31,.16)', animation: 'sheetIn .5s cubic-bezier(.2,1.25,.4,1) backwards' }}
          >
            <Mascot mood="searching" size={36} steam={false} shadow={false} interactive={false} className="-my-1" />
            Finding your location...
          </div>
        ) : null}

        {phase === 'located' || phase === 'craving' ? (
          <div className="sheet max-w-[600px] p-[22px]">
            <div className="flex items-center gap-3.5">
              <Mascot
                mood={snap.status === 'working' ? 'searching' : snap.status === 'error' ? 'sad' : listening ? 'listening' : cravingGaze.focused ? 'curious' : 'idle'}
                size={68}
                follow
                lookAt={cravingGaze.point}
                steam={false}
                className="flex-none"
              />
              <div className="min-w-0">
                <p className="m-0 font-display text-2xl font-semibold">{headline}</p>
                <p className="mb-0 mt-0.5 text-sm text-muted">{reason}</p>
              </div>
            </div>
            <form onSubmit={(event) => void submitCraving(event)} className="mt-4 flex gap-2 rounded-[18px] bg-mist p-1.5" style={{ boxShadow: '0 0 0 1.5px #ece8ee' }}>
              <Search className="my-auto ml-2.5 flex-none text-faint" size={19} strokeWidth={2.5} />
              <input
                placeholder="Mild chicken biryani, spicy beef fry..."
                value={craving}
                onChange={(event) => setCraving(event.target.value)}
                aria-label="What are you craving?"
                className="min-w-0 flex-1 border-none bg-transparent text-base font-medium text-ink outline-none"
                {...cravingGaze.bind}
              />
              <Mic onText={setCraving} onListening={setListening} />
              <SnapButton
                className="h-[46px] w-[46px]"
                onChange={(state) => {
                  setSnap(state);
                  if (state.status === 'done' && state.dish) {
                    setCraving(state.dish);
                    void advance(state.dish);
                  }
                }}
              />
              <button type="submit" className="btn-primary h-[46px] flex-none rounded-xl px-5 shadow-none">
                Search
              </button>
            </form>
            <div className="no-scrollbar mt-4 flex gap-3.5 overflow-x-auto pb-0.5">
              {CATEGORIES.map((category, i) => (
                <button
                  key={category.label}
                  onClick={() => setCraving(category.label)}
                  className="flex flex-none cursor-pointer flex-col items-center gap-1.5 border-none bg-transparent p-0 text-xs font-semibold text-ink-2 transition-transform duration-300 [transition-timing-function:var(--spring)] hover:-translate-y-1"
                  style={{ animation: `fadeUp .4s ease ${i * 50}ms backwards` }}
                >
                  <Photo src={category.img} className="h-[58px] w-[58px] rounded-full border-[3px] border-white bg-peach" style={{ boxShadow: '0 0 0 2px #ffd0b0' }} />
                  {category.label}
                </button>
              ))}
            </div>
            {snap.status === 'working' ? <p className="mb-0 mt-3 text-xs font-semibold text-tomato">Looking at your photo with Google Lens...</p> : null}
            {snap.status === 'error' ? <p className="mb-0 mt-3 text-xs font-semibold text-[#d42a35]">{snap.message}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1 rounded-full bg-blush px-2.5 py-1 text-tomato-deep">
                <Camera size={12} strokeWidth={2.75} /> Snap a dish with the camera
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff0f3] px-2.5 py-1 text-[#c2185b]">
                <Heart size={12} strokeWidth={2.75} className="fill-current" /> Taste twins on every search
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2.5 py-1 text-tomato-deep">
                <BookOpen size={12} strokeWidth={2.75} /> Menus with prices
              </span>
            </div>
            <p className="mb-0 mt-2 text-xs text-faint">Food, restaurants, and hotels only.</p>
          </div>
        ) : null}

        {phase === 'constraints' ? (
          <div className="sheet max-h-[56vh] max-w-[600px] overflow-auto p-[22px]">
            <div className="flex items-center gap-3">
              <Mascot mood={chipCheer ? 'happy' : 'idle'} size={56} follow steam={false} className="flex-none" />
              <p className="m-0 min-w-0 flex-1 font-display text-2xl font-semibold">How do you like it?</p>
              <button type="button" onClick={() => setPhase('located')} className="flex-none cursor-pointer border-none bg-transparent p-0 text-sm font-bold text-tomato hover:underline">
                Change craving
              </button>
            </div>
            <ChipGroup title="Radius">
              {RADII.map((item, i) => (
                <Chip key={item.id} index={i} active={radius === item.id} onClick={() => { setRadius(item.id); setChipAt(Date.now()); }}>
                  {item.label}
                </Chip>
              ))}
            </ChipGroup>
            <ChipGroup title="Preferences">
              {PREFS.map((item, i) => (
                <Chip key={item} index={i} active={prefs.includes(item)} onClick={() => { setPrefs((current) => toggle(current, item)); setChipAt(Date.now()); }}>
                  {item}
                </Chip>
              ))}
            </ChipGroup>
            <ChipGroup title="Add-ons">
              {ADDONS.map((item, i) => (
                <Chip key={item} index={i} active={addons.includes(item)} onClick={() => { setAddons((current) => toggle(current, item)); setChipAt(Date.now()); }}>
                  {item}
                </Chip>
              ))}
            </ChipGroup>
            <button onClick={() => void search()} className="btn-primary mt-5 h-[52px] w-full text-base">
              Read reviews
            </button>
          </div>
        ) : null}

        {phase === 'searching' ? (
          <div className="sheet max-h-[60vh] max-w-[520px] overflow-auto p-[22px]">
            <div className="flex items-center gap-3.5">
              <Mascot mood={agentMood(steps)} size={76} steam={false} className="flex-none" />
              <div className="min-w-0">
                <p className="m-0 font-display text-[22px] font-semibold leading-tight">YumFindAI is on it</p>
                <p className="m-0 text-[13px] font-medium text-muted">Choosing which Google data to pull, live through SerpApi.</p>
              </div>
            </div>
            <div className="mt-4">
              <AgentTrace steps={steps} />
            </div>
          </div>
        ) : null}

        {phase === 'ranking' ? (
          <div className="sheet min-w-0 max-w-[1220px] p-[18px]">
            <div className="mx-1.5 mb-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Mascot mood={celebrating ? 'found' : 'idle'} size={60} follow steam={false} className="flex-none" />
                <ReviewReport headline={headline} places={ranked} />
              </div>
              <div className="flex flex-none gap-2">
              <button
                type="button"
                onClick={() => {
                  setChatOpen(false);
                  setSelectedId(null);
                  setPhase('located');
                }}
                className="btn-outline h-11 px-4"
              >
                <Search size={15} strokeWidth={2.5} />
                New search
              </button>
              <button className={`${chatOpen ? 'btn-primary shadow-none' : 'btn-outline'} h-11 flex-none px-4`} type="button" onClick={() => setChatOpen((open) => !open)}>
                <MessageCircle size={15} strokeWidth={2.5} />
                {chatOpen ? 'Chat open' : 'Ask about these'}
              </button>
              </div>
            </div>
            <ResultCarousel places={ranked} onOpen={openPlace} />
            {trace.length ? (
              <div className="mx-1.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowTrace((open) => !open)}
                  className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-xs font-bold text-tomato hover:underline"
                >
                  <LogoMark size={16} />
                  How YumFindAI decided{costLabel(usage) ? ` · ${costLabel(usage)}` : ''}
                  {showTrace ? <ChevronUp size={13} strokeWidth={2.75} /> : <ChevronDown size={13} strokeWidth={2.75} />}
                </button>
                {showTrace ? (
                  <div className="mt-2 max-h-[26vh] overflow-auto rounded-2xl bg-mist px-4 py-3" style={{ animation: 'fadeUp .3s ease backwards' }}>
                    <AgentTrace steps={trace.map((row, index) => ({ id: index + 1, tool: row.tool, say: row.say, status: 'done', summary: row.summary }))} compact />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === 'place' && selected ? (
          <PlaceCard place={selected} craving={craving} routeNote={routeNote} driveMin={parseDuration(route?.duration)} onClose={closePlace} />
        ) : null}

        {phase === 'error' ? (
          <div className="sheet max-w-[460px] p-[22px]">
            <div className="flex items-center gap-3.5">
              <Mascot mood="sad" size={64} steam={false} className="flex-none" />
              <p className="m-0 text-[15px] font-semibold">{error}</p>
            </div>
            <div className="mt-3.5 flex gap-2">
              <button onClick={locate} className="btn-primary h-[46px] rounded-xl px-5 shadow-none">
                Try locate
              </button>
              <button onClick={() => { if (user) setDropMode(false); setPhase(user ? 'located' : 'idle'); }} className="btn-outline h-[46px] px-5 text-[15px]">
                Back to map
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {chatVisible ? (
        <div className="absolute inset-x-2 bottom-2 top-[26%] z-30 flex md:inset-x-auto md:bottom-4 md:right-4 md:top-[92px] md:w-[400px]">
          <ChatPanel
            key={fingerprint}
            fingerprint={fingerprint}
            placeCount={ranked.length}
            user={user}
            onClose={() => setChatOpen(false)}
            onShowPlace={showFromChat}
            onAnswer={onChatAnswer}
          />
        </div>
      ) : null}
    </main>
  );
}

function ChipGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-[.06em] text-faint">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </>
  );
}

function Chip({ active, index, onClick, children }: { active: boolean; index: number; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={active} style={{ animationDelay: `${index * 40}ms` }} onClick={onClick}>
      {children}
    </button>
  );
}

function ReviewReport({ headline, places }: { headline: string; places: Place[] }) {
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
      <p className="m-0 font-display text-[22px] font-semibold">{headline || 'Review report'}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted">
        <span>{read ? `${read} reviews, last 3 months` : 'No recent reviews'}</span>
        {(['positive', 'neutral', 'negative'] as const).map((tone) => (
          <span key={tone} className="rounded-full px-[9px] py-[3px]" style={{ background: TONES[tone].bg, color: TONES[tone].fg }}>
            {totals[tone]} {tone}
          </span>
        ))}
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
    node.scrollBy({ left: direction * ((card ? card.offsetWidth : 260) + 16), behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <button type="button" aria-label="Previous restaurants" onClick={() => move(-1)} className="btn-round absolute left-0 top-1/2 z-[2] -mt-[21px]">
        <ChevronLeft size={18} strokeWidth={2.75} />
      </button>
      <div ref={scroller} className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-[52px] pb-2.5 pt-1.5">
        {places.map((place, index) => (
          <ResultCard key={place.id} place={place} rank={index + 1} onOpen={() => onOpen(place.id)} />
        ))}
      </div>
      <button type="button" aria-label="Next restaurants" onClick={() => move(1)} className="btn-round absolute right-0 top-1/2 z-[2] -mt-[21px]">
        <ChevronRight size={18} strokeWidth={2.75} />
      </button>
    </div>
  );
}

function ResultCard({ place, rank, onOpen }: { place: Place; rank: number; onOpen: () => void }) {
  const counts = sentimentOf(place);
  const latest = place.latestReview || place.reviews?.[0] || null;
  const review = latest?.snippet || 'No recent review';
  const [expanded, setExpanded] = useState(false);
  const canExpand = review.length > 70;
  return (
    <div
      data-card
      className="flex w-[260px] flex-none snap-start flex-col overflow-hidden rounded-[22px] bg-white transition-[transform,box-shadow] duration-300 ease-out hover:shadow-[0_20px_44px_rgba(28,26,31,.16)]"
      style={{ boxShadow: '0 0 0 1px #f1edf2', animation: `cardIn .55s cubic-bezier(.2,1.1,.4,1) ${(rank - 1) * 70}ms backwards` }}
    >
      <button type="button" onClick={onOpen} className="zoom-host block cursor-pointer border-none bg-transparent p-0 text-left font-[inherit] text-inherit">
        <div className="relative h-[130px]">
          <Photo src={place.thumbnail} className="h-full w-full" imgClassName="zoom-img" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%]" style={{ background: 'linear-gradient(to top,rgba(20,12,10,.7),transparent)' }} />
          <span
            className="absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-white"
            style={{ background: 'var(--grad)', boxShadow: '0 4px 10px rgba(0,0,0,.2)' }}
          >
            {rank}
          </span>
          <span className="absolute bottom-2.5 left-3 text-xs font-bold text-white">{distanceLabel(place.distanceM)}</span>
          {place.rating != null ? <span className="rating-badge absolute bottom-[9px] right-2.5">★ {place.rating.toFixed(1)}</span> : null}
        </div>
        <div className="px-3.5 pt-3">
          <h2 className="m-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-lg font-semibold">{place.name}</h2>
          {place.address ? <p className="m-0 mt-px overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-muted">{place.address}</p> : null}
          <p className={`mb-0 mt-2 text-[13px] leading-[1.45] text-ink-2 ${expanded ? '' : 'line-clamp-2'}`}>{review}</p>
          <Dishes dishes={place.dishes} small />
          <TwinsBadge twins={place.twins} />
          <OpenLine timing={timing(place.hours, estimateDriveMin(place.distanceM))} small />
        </div>
      </button>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mx-3.5 mt-1 cursor-pointer self-start border-none bg-transparent p-0 text-xs font-bold text-tomato hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 px-3.5 pb-3.5 pt-3 text-[11px] font-bold">
        <div className="flex gap-1.5">
          <span className="rounded-full px-2 py-[3px]" style={{ background: TONES.positive.bg, color: TONES.positive.fg }}>
            {counts.positive} positive
          </span>
          <span className="rounded-full px-2 py-[3px]" style={{ background: TONES.negative.bg, color: TONES.negative.fg }}>
            {counts.negative} negative
          </span>
        </div>
        <span className="font-semibold text-faint">Last 3 months</span>
      </div>
    </div>
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

const OPEN_TONES: Record<Timing['tone'], string> = {
  good: '#137a41',
  warn: '#b45309',
  bad: '#c4222d',
  muted: '#6b6870',
};

/** "Closes in 40 min · ~12 min away", coloured by whether you'd make it. */
function OpenLine({ timing: value, small = false }: { timing: Timing | null; small?: boolean }) {
  if (!value) return null;
  return (
    <p
      className={`m-0 flex items-center gap-1.5 font-bold ${small ? 'mt-2 text-[11px]' : 'mt-3 text-sm'}`}
      style={{ color: OPEN_TONES[value.tone] }}
    >
      <Clock size={small ? 12 : 15} strokeWidth={2.75} className="flex-none" />
      <span className="min-w-0">{value.label}</span>
    </p>
  );
}

function TwinAvatar({ twin, size }: { twin: TasteTwin; size: number }) {
  return twin.photo ? (
    <img
      src={twin.photo}
      alt=""
      referrerPolicy="no-referrer"
      className="flex-none rounded-full border-2 border-white object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="grid flex-none place-items-center rounded-full border-2 border-white font-display font-bold text-ink"
      style={{ width: size, height: size, background: 'var(--grad-coin)', fontSize: size * 0.42 }}
    >
      {twin.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "♥ 2 taste twins loved it" on a result card. */
function TwinsBadge({ twins }: { twins?: TasteTwin[] }) {
  if (!twins?.length) return null;
  const loved = twins.filter((twin) => (twin.rating ?? 0) >= 4).length;
  const label = loved
    ? `${loved} taste twin${loved === 1 ? '' : 's'} loved it`
    : `${twins.length} taste twin${twins.length === 1 ? '' : 's'} reviewed it`;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#fff0f3] px-2 py-1.5 text-[11px] font-bold text-[#c2185b]">
      <span className="flex -space-x-2">
        {twins.slice(0, 3).map((twin) => (
          <TwinAvatar key={twin.name} twin={twin} size={20} />
        ))}
      </span>
      <Heart size={12} strokeWidth={2.75} className="flex-none fill-current" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

/** Reviewers who eat like the user, why they match, and what they said here. */
function TwinsSection({ twins }: { twins?: TasteTwin[] }) {
  if (!twins?.length) return null;
  return (
    <section className="mt-4 rounded-2xl bg-[#fff0f3] p-3.5" style={{ animation: 'fadeUp .4s ease backwards' }}>
      <p className="m-0 flex items-center gap-1.5 font-display text-[17px] font-semibold text-[#c2185b]">
        <Heart size={15} strokeWidth={2.75} className="fill-current" />
        Your taste twins
      </p>
      <p className="m-0 mt-0.5 text-xs font-medium text-muted">Reviewers here whose other reviews match how you like your food.</p>
      <div className="mt-2.5 flex flex-col gap-2">
        {twins.map((twin) => (
          <div key={twin.name} className="flex gap-2.5 rounded-xl bg-white p-2.5">
            <TwinAvatar twin={twin} size={34} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold text-ink">
                <span>{twin.name}</span>
                {twin.localGuide ? (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted">
                    <BadgeCheck size={12} strokeWidth={2.5} /> Local Guide
                  </span>
                ) : null}
                <span className="rounded-full bg-[#c2185b] px-1.5 py-px text-[10px] font-bold text-white">{twin.match}% match</span>
                {twin.rating != null ? <span className="text-[11px] text-[#b45309]">{'★'.repeat(Math.round(twin.rating))}</span> : null}
              </div>
              <p className="m-0 mt-0.5 text-xs font-medium text-muted">{twin.why}</p>
              <p className="m-0 mt-1 text-[13px] leading-snug text-ink-2">"{twin.said}"</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Dishes({ dishes, small = false }: { dishes?: string[]; small?: boolean }) {
  if (!dishes?.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${small ? 'mt-2' : 'mt-1.5'}`}>
      {dishes.map((dish) => (
        <span
          key={dish}
          className={`rounded-full bg-peach font-bold text-tomato-deep ${small ? 'px-2 py-[2px] text-[11px]' : 'px-2.5 py-1 text-xs'}`}
        >
          {dish}
        </span>
      ))}
    </div>
  );
}

function PlaceCard({ place, craving, routeNote, driveMin, onClose }: { place: Place; craving: string; routeNote: string; driveMin: number | null; onClose: () => void }) {
  const open = timing(place.hours, driveMin ?? estimateDriveMin(place.distanceM), driveMin != null);
  const reviews = place.reviews || [];
  const counts = sentimentOf(place);
  const meta = [
    place.reviewsCount != null ? `${place.reviewsCount} Google reviews` : null,
    rupees(place.priceLevel),
    distanceLabel(place.distanceM),
    place.openNow ? 'Open' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="sheet relative max-h-[66vh] max-w-[480px] overflow-hidden" style={{ boxShadow: '0 24px 60px rgba(28,26,31,.2)' }}>
      <button
        type="button"
        aria-label="Back to results"
        onClick={onClose}
        className="absolute right-3.5 top-3.5 z-[3] grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-full border-none bg-white/95 text-ink transition-transform duration-[250ms] [transition-timing-function:var(--spring)] hover:scale-[1.08]"
        style={{ boxShadow: '0 6px 16px rgba(0,0,0,.18)' }}
      >
        <X size={16} strokeWidth={2.75} />
      </button>
      <div className="max-h-[66vh] overflow-auto">
        <div className="relative h-[190px]">
          <Photo src={place.thumbnail} className="h-full w-full" style={{ animation: 'fadeIn .5s ease backwards' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top,rgba(20,12,10,.82) 0%,rgba(20,12,10,.1) 60%,transparent)' }} />
          <div className="absolute bottom-4 left-5 right-5 text-white" style={{ animation: 'fadeUp .5s ease .1s backwards' }}>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[.12em] text-sun">Review report</p>
            <h2 className="m-0 mt-0.5 font-display text-[30px] font-bold leading-[1.1]">{place.name}</h2>
          </div>
        </div>
        <div className="px-5 pb-6 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
            {place.rating != null ? <span className="rating-badge rounded-lg px-[9px] py-1 text-[13px]">★ {place.rating.toFixed(1)}</span> : null}
            {meta ? <span>{meta}</span> : null}
          </div>
          {routeNote ? (
            <p
              className="mb-0 mt-3 inline-flex items-center gap-2 rounded-xl bg-blush px-3.5 py-2 text-sm font-bold text-tomato-deep"
              style={{ animation: 'popIn .4s cubic-bezier(.2,1.4,.4,1) backwards' }}
            >
              <Navigation size={14} strokeWidth={2.75} />
              {routeNote}
            </p>
          ) : null}
          <OpenLine timing={open} />
          {place.address ? <p className="mb-0 mt-2.5 text-sm text-muted">{place.address}</p> : null}
          <TwinsSection twins={place.twins} />
          <MenuSection key={place.id} placeId={place.id} craving={craving} />
          {place.dishes?.length ? (
            <div className="mt-3">
              <p className="m-0 text-xs font-bold uppercase tracking-[.06em] text-faint">Reviewers love</p>
              <Dishes dishes={place.dishes} />
            </div>
          ) : null}
          {place.verdict ? (
            <p className="mb-0 mt-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[#7a4a00]" style={{ background: 'linear-gradient(135deg,#fff6d6,#ffeccc)' }}>
              {place.verdict}
            </p>
          ) : null}
          <p className="mb-0 mt-3 text-sm text-ink-2">Read {counts.positive + counts.neutral + counts.negative} reviews from the last 3 months.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['positive', 'neutral', 'negative'] as const).map((tone, i) => (
              <div
                key={tone}
                className="rounded-2xl px-2 py-3 text-center transition-transform duration-[250ms] [transition-timing-function:var(--spring)] hover:-translate-y-1"
                style={{ background: TONES[tone].bg, color: TONES[tone].fg, animation: `fadeUp .45s ease ${0.05 + i * 0.07}s backwards` }}
              >
                <div className="font-display text-[28px] font-bold leading-[1.1]">{counts[tone]}</div>
                <div className="text-xs font-bold">{TONES[tone].label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-[18px]">
            {reviews.length === 0 ? <p className="m-0 text-sm text-muted">No recent reviews stored.</p> : null}
            {(['positive', 'neutral', 'negative'] as const).map((tone) => (
              <ReviewGroup key={tone} tone={tone} reviews={reviews.filter((review) => toneOf(review.rating) === tone)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewGroup({ tone, reviews }: { tone: Tone; reviews: Review[] }) {
  if (!reviews.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 flex items-center gap-2 font-display text-[17px] font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONES[tone].dot }} />
        {TONES[tone].label}
      </h3>
      {reviews.map((review) => {
        const author = review.author || 'Guest';
        return (
          <div
            key={review.publishedAt + review.snippet}
            className="flex gap-3 rounded-2xl bg-mist px-3.5 py-3 transition-[transform,background] duration-200 hover:translate-x-1 hover:bg-peach"
          >
            <span
              className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full font-display text-sm font-bold text-ink"
              style={{ background: AVATAR_BG[author.charCodeAt(0) % AVATAR_BG.length] }}
            >
              {author[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <span className="text-xs font-bold text-muted">
                {author}
                {review.rating != null ? ` · ${review.rating}★` : ''}
              </span>
              <p className="m-0 mt-0.5 text-sm text-ink">{review.snippet}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Mic({ onText, onListening }: { onText: (value: string) => void; onListening?: (on: boolean) => void }) {
  const [listening, setListening] = useState(false);
  const win = window as Window & {
    SpeechRecognition?: new () => SpeechHandle;
    webkitSpeechRecognition?: new () => SpeechHandle;
  };
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  const active = useRef<SpeechHandle | null>(null);
  // Leaving the craving step stops listening, so a late transcript can't change a confirmed craving.
  useEffect(
    () => () => {
      const rec = active.current;
      if (!rec) return;
      rec.onresult = null;
      rec.abort?.();
    },
    [],
  );
  if (!Ctor) return null;
  return (
    <button
      type="button"
      aria-label="Speak your craving"
      className="grid h-[46px] w-[46px] flex-none cursor-pointer place-items-center rounded-xl border-none bg-white text-tomato hover:bg-blush"
      style={{ boxShadow: '0 2px 8px rgba(28,26,31,.08)', animation: listening ? 'listen 1s ease-in-out infinite' : 'none' }}
      onClick={() => {
        const rec = new Ctor();
        active.current = rec;
        rec.lang = 'en-IN';
        rec.onresult = (event) => onText(event.results[0][0].transcript);
        rec.onend = () => {
          setListening(false);
          onListening?.(false);
        };
        setListening(true);
        onListening?.(true);
        rec.start();
      }}
    >
      <MicIcon size={19} strokeWidth={2.5} />
    </button>
  );
}

type SpeechHandle = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  abort?: () => void;
  start: () => void;
};
