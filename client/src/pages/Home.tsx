import { Logo, Photo, foodImg, useTitle } from '@/components/brand';
import { Mascot, useInputGaze, type MascotMood } from '@/components/mascot/Mascot';
import { InstallBanner } from '@/components/Pwa';
import { useSession } from '@/lib/session';
import { currentPosition, placeNameFor, readSpot, saveSpot, type Spot } from '@/lib/spot';
import { ArrowRight, BookOpen, Camera, Check, Heart, LocateFixed, Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const QUICK_PICKS = ['Mild chicken biryani', 'Spicy beef fry', 'Pure veg thali', 'Quiet cafe'];
const HEADLINE = ['Food', 'that', 'fits'];

type Feature = { id: 'match' | 'twins' | 'snap' | 'menu'; icon: typeof Heart; title: string; text: string };

/** The four things a map app does not do; each card carries a small preview of the real UI. */
const FEATURES: Feature[] = [
  {
    id: 'match',
    icon: Sparkles,
    title: "The best match, from this month's reviews",
    text: 'An AI agent searches Google Maps, reads the newest reviews for your exact dish and how you like it, and ranks only what the evidence backs. Every pick says why.',
  },
  {
    id: 'twins',
    icon: Heart,
    title: 'Taste Twins',
    text: 'A 4.5★ average mixes everyone. YumFindAI finds the reviewers who eat like you, reads their review history, and shows what they said about each place.',
  },
  {
    id: 'snap',
    icon: Camera,
    title: 'Snap a dish',
    text: 'Saw it on Instagram? Take or upload a photo. Google Lens names the dish and YumFindAI finds who makes it best near you.',
  },
  {
    id: 'menu',
    icon: BookOpen,
    title: 'Menu & prices',
    text: 'Restaurants post their menu as photos on Google Maps. YumFindAI reads them into a searchable price list, with your dish on top.',
  },
];

const floatCircle: CSSProperties = {
  border: '6px solid #fff',
  boxShadow: '0 16px 36px rgba(28,26,31,.2)',
};

function short(text: string, max = 22) {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** "Ashok Nagar, Bengaluru" -> "Bengaluru" when the full name is too long for the bubble. */
function town(label: string | null) {
  if (!label) return null;
  return label.length <= 22 ? label : label.split(',').pop()?.trim() || label;
}

export function Home() {
  useTitle();
  const navigate = useNavigate();
  const { session, initial } = useSession();
  // Step 1 is knowing where the user is; the craving search only appears after that.
  const [spot, setSpot] = useState<Spot | null>(readSpot);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [foundAt, setFoundAt] = useState(0);
  const [craving, setCraving] = useState('');
  const [greeting, setGreeting] = useState(true);
  const [goHover, setGoHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const input = useInputGaze();
  const justFound = foundAt > 0 && Date.now() - foundAt < 2400;

  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), 2600);
    return () => window.clearTimeout(id);
  }, []);

  // Once we know where the user is, the map is the next stop: fetch its code while they type.
  useEffect(() => {
    if (!spot) return;
    const warm = () => void import('@/pages/Dashboard');
    const idle = (window as Window & { requestIdleCallback?: (fn: () => void) => number }).requestIdleCallback;
    if (idle) idle(warm);
    else window.setTimeout(warm, 1500);
  }, [spot]);

  useEffect(() => {
    if (!foundAt) return;
    const id = window.setTimeout(() => setFoundAt(0), 2400);
    return () => window.clearTimeout(id);
  }, [foundAt]);

  function go(label: string, where: { lat: number; lng: number }) {
    const params = new URLSearchParams({ lat: where.lat.toFixed(6), lng: where.lng.toFixed(6) });
    if (label.trim()) params.set('q', label.trim());
    const target = `/dashboard?${params.toString()}`;
    setLeaving(true);
    // A short beat so the mascot's cheer is visible before the page changes.
    window.setTimeout(() => navigate(session ? target : '/login', session ? undefined : { state: { next: target } }), 380);
  }

  async function locate(then?: string) {
    if (locating) return;
    setLocating(true);
    setLocError('');
    try {
      const where = await currentPosition();
      const next = { ...where, label: await placeNameFor(where.lat, where.lng) };
      saveSpot(next);
      setSpot({ ...next, at: Date.now() });
      setFoundAt(Date.now());
      if (then) go(then, next);
    } catch (error) {
      setLocError(error instanceof Error ? error.message : "Couldn't find you.");
    } finally {
      setLocating(false);
    }
  }

  /** A craving picked before locating runs the locate step first, then carries on. */
  function pick(label: string) {
    if (spot) {
      go(label, spot);
      return;
    }
    setCraving(label);
    void locate(label);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    pick(craving);
  }

  const typing = Boolean(input.focused);
  const where = town(spot?.label ?? null);
  let mood: MascotMood = 'idle';
  if (leaving || justFound) mood = 'found';
  else if (locating) mood = 'searching';
  else if (locError) mood = 'sad';
  else if (goHover) mood = 'happy';
  else if (typing) mood = 'curious';
  else if (greeting && !spot) mood = 'wave';

  let bubble = { kind: 'ask', text: `What are you in the mood for${where ? ` in ${where}` : ''}? I'll match it to your taste.` };
  if (leaving) bubble = { kind: 'go', text: 'On it! Reading the reviews.' };
  else if (locating) bubble = { kind: 'locating', text: 'Looking around for you...' };
  else if (locError) bubble = { kind: 'error', text: "I can't see where you are. Drop a pin on the map?" };
  else if (!spot) bubble = { kind: 'hello', text: "Hi, I'm YumFindAI. First, where are you?" };
  else if (justFound) bubble = { kind: 'found', text: `Found you${where ? ` in ${where}` : ''}! How do you like your food?` };
  else if (goHover) bubble = { kind: 'hover', text: "Let's eat!" };
  else if (craving.trim()) bubble = { kind: 'craving', text: `${short(craving)}? I'll find who makes it your way.` };
  else if (typing) bubble = { kind: 'typing', text: 'Type a dish. I read the newest reviews.' };

  return (
    <main className="min-h-dvh overflow-x-clip bg-white" style={{ animation: 'fadeIn .5s ease backwards' }}>
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-[14px]">
        <div className="flex items-center gap-3 px-[clamp(16px,4vw,56px)] py-3 sm:gap-4 sm:py-4">
        <Logo size={34} text={21} />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          {session ? (
            <button
              onClick={() => navigate('/profile')}
              className="flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-line-2 bg-white py-[5px] pl-[5px] pr-3.5 text-sm font-semibold text-ink transition-[translate,border-color] duration-300 hover:border-tomato"
            >
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full font-display text-sm font-bold" style={{ background: 'var(--grad-coin)' }}>
                {initial}
              </span>
              <span className="max-[359px]:hidden">Profile</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/signup')}
                className="cursor-pointer border-none bg-transparent px-2.5 py-2.5 text-[15px] font-semibold text-ink transition-colors hover:text-tomato max-[379px]:hidden sm:px-3"
              >
                Sign up
              </button>
              <button onClick={() => navigate('/login')} className="btn-primary px-4 py-2.5 hover:-translate-y-0.5 sm:px-[22px] sm:py-[11px]">
                Log in
              </button>
            </>
          )}
        </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1320px] grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-[clamp(28px,5vw,72px)] px-[clamp(16px,4vw,56px)] pb-10 pt-[clamp(24px,5vw,64px)]">
        <div className="flex min-w-0 max-w-[600px] flex-col gap-[18px] sm:gap-[22px]">
          <span
            className="inline-flex items-center gap-2 self-start rounded-full bg-blush py-[7px] pl-2 pr-3.5 text-[13px] font-bold text-tomato-deep"
            style={{ animation: 'fadeUp .6s ease backwards' }}
          >
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full text-white" style={{ background: 'var(--grad)' }}>
              <Sparkles size={12} strokeWidth={3} />
            </span>
            Not just nearby. Matched to your taste.
          </span>
          <h1 className="m-0 font-display text-[clamp(40px,11vw,84px)] font-bold leading-none tracking-[-.025em] [text-wrap:balance]">
            {HEADLINE.map((word, i) => (
              <span key={word} className="inline-block" style={{ animation: `blurIn .8s cubic-bezier(.2,.7,.2,1) ${0.05 + i * 0.07}s backwards` }}>
                {word}&nbsp;
              </span>
            ))}
            <span className="relative inline-block" style={{ animation: 'blurIn .8s cubic-bezier(.2,.7,.2,1) .33s backwards' }}>
              your
              <svg viewBox="0 0 120 20" preserveAspectRatio="none" className="absolute bottom-[-8px] left-[-4%] h-4 w-[108%] overflow-visible">
                <path
                  d="M3 13 C 30 4, 70 4, 117 10"
                  fill="none"
                  stroke="#ffc531"
                  strokeWidth="7"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray="1"
                  strokeDashoffset="1"
                  style={{ animation: 'draw .7s ease 1s forwards' }}
                />
              </svg>
            </span>{' '}
            <span className="text-grad inline-block" style={{ animation: 'blurIn .8s cubic-bezier(.2,.7,.2,1) .4s backwards' }}>
              taste.
            </span>
          </h1>
          <p className="m-0 max-w-[480px] text-base leading-relaxed text-muted [text-wrap:pretty] sm:text-lg" style={{ animation: 'fadeUp .7s ease .5s backwards' }}>
            Google Maps lists everything around you. YumFindAI picks what fits you: it reads this month's reviews for your dish, finds reviewers who eat like you, reads the menu prices, and can even start from a photo of a dish.
          </p>
          {spot ? (
            <div className="flex max-w-[560px] flex-col gap-3" style={{ animation: 'fadeUp .5s ease backwards' }}>
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-2">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[#e6f6ed] text-[#137a41]">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span className="min-w-0 truncate">
                  You're in <b className="text-ink">{spot.label || 'your current location'}</b>
                </span>
                <button
                  type="button"
                  onClick={() => void locate()}
                  disabled={locating}
                  className="flex-none cursor-pointer border-none bg-transparent p-0 text-sm font-bold text-tomato hover:underline disabled:cursor-default disabled:opacity-60"
                >
                  {locating ? 'Locating...' : 'Change'}
                </button>
              </div>
              <form
                onSubmit={onSearch}
                className="flex items-center gap-2 rounded-[20px] bg-white p-2"
                style={{ boxShadow: '0 18px 50px rgba(28,26,31,.10),0 0 0 1px #f1edf2' }}
              >
                <Search className="ml-2 flex-none text-faint sm:ml-3" size={20} strokeWidth={2.5} />
                <input
                  value={craving}
                  onChange={(event) => setCraving(event.target.value)}
                  placeholder="Mild chicken biryani, spicy beef fry..."
                  aria-label="What are you craving, and how do you like it?"
                  autoFocus={justFound}
                  className="min-w-0 flex-1 border-none bg-transparent px-1 py-3 text-base font-medium text-ink outline-none"
                  {...input.bind}
                />
                <button
                  type="submit"
                  aria-label="Find food"
                  className="btn-primary h-12 flex-none px-4 sm:px-[22px]"
                  onPointerEnter={() => setGoHover(true)}
                  onPointerLeave={() => setGoHover(false)}
                >
                  <span className="max-[379px]:hidden">Find food</span>
                  <ArrowRight size={16} strokeWidth={2.75} />
                </button>
              </form>
              <div className="flex flex-wrap gap-2">
                {QUICK_PICKS.map((label) => (
                  <button key={label} className="pill-link" onClick={() => pick(label)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <LocateStep locating={locating} error={locError} onLocate={() => void locate()} />
          )}
        </div>

        <HeroArt mood={mood} lookAt={input.point} bubble={bubble} />
      </section>

      <section className="mx-auto max-w-[1320px] px-[clamp(16px,4vw,56px)] pb-14 pt-6 sm:pb-20">
        <p className="m-0 text-[13px] font-extrabold uppercase tracking-[.1em] text-tomato">What a map app can't do</p>
        <h2 className="m-0 mt-1 font-display text-[clamp(28px,3.4vw,40px)] font-bold tracking-[-.015em]">Not another map. A match for your taste.</h2>
        <p className="m-0 mt-1.5 max-w-[680px] text-base text-muted">
          A map shows what is near. YumFindAI works out what is right for you, and shows the evidence.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <article
              key={feature.id}
              className="flex flex-col rounded-[22px] bg-white p-4 sm:rounded-[26px] sm:p-6"
              style={{ boxShadow: '0 0 0 1px #f1edf2, 0 18px 40px rgba(28,26,31,.06)', animation: `fadeUp .5s ease ${i * 80}ms backwards` }}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl text-white" style={{ background: 'var(--grad)' }}>
                  <feature.icon size={20} strokeWidth={2.5} />
                </span>
                <h3 className="m-0 font-display text-lg font-semibold leading-tight sm:text-xl">{feature.title}</h3>
              </div>
              <p className="m-0 mt-3 text-[15px] leading-relaxed text-muted">{feature.text}</p>
              <div className="mt-4 flex-1 rounded-2xl bg-mist p-3.5" aria-hidden="true">
                <FeaturePreview id={feature.id} />
              </div>
            </article>
          ))}
        </div>
      </section>


      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(16px,4vw,56px)] py-6 pb-[max(24px,env(safe-area-inset-bottom))]">
          <Logo size={30} text={18} />
          <p className="m-0 text-sm font-medium text-muted">YumFindAI finds food with live Google Maps, reviews, web and directions data from SerpApi.</p>
        </div>
      </footer>
      <InstallBanner />
    </main>
  );
}

/** Small, static previews of each feature, drawn from what the app really shows. */
function FeaturePreview({ id }: { id: Feature['id'] }) {
  if (id === 'match') {
    return (
      <div className="flex gap-3 rounded-xl bg-white p-2.5">
        <Photo src={foodImg('1563379091339-03b21ab4a4f8', 200)} className="h-16 w-16 flex-none rounded-xl" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[15px] font-semibold">Malabar Menu</span>
            <span className="rating-badge flex-none">★ 4.6</span>
          </div>
          <p className="m-0 mt-0.5 text-xs leading-snug text-ink-2">Reviewers this month praise the consistently good dum biryani.</p>
          <span className="mt-1.5 inline-block rounded-full bg-peach px-2 py-px text-[11px] font-bold text-tomato-deep">chicken dum biryani</span>
        </div>
      </div>
    );
  }
  if (id === 'twins') {
    return (
      <div className="rounded-xl bg-[#fff0f3] p-2.5">
        <div className="flex gap-2.5 rounded-lg bg-white p-2.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full font-display font-bold" style={{ background: 'var(--grad-coin)' }}>
            A
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              Arjun <span className="rounded-full bg-[#c2185b] px-1.5 py-px text-[10px] text-white">78% match</span>
            </div>
            <p className="m-0 mt-0.5 text-xs text-muted">Loved the chicken dum biryani and rates family places highly</p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#c2185b]">
          <Heart size={12} strokeWidth={2.75} className="fill-current" /> 2 taste twins loved it
        </div>
      </div>
    );
  }
  if (id === 'snap') {
    return (
      <div className="flex items-center gap-3">
        <Photo src={foodImg('1668236543090-82eba5ee5976', 200)} className="h-20 w-20 flex-none rounded-xl" />
        <ArrowRight size={18} strokeWidth={2.75} className="flex-none text-faint" />
        <div className="min-w-0 rounded-xl bg-white p-2.5">
          <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold text-muted">
            <Camera size={12} strokeWidth={2.75} /> Google Lens
          </p>
          <p className="m-0 font-display text-[15px] font-semibold">Looks like masala dosa</p>
          <p className="m-0 text-[11px] font-semibold text-leaf">95% sure · finding it near you</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-white px-3 py-2">
      <p className="m-0 text-[10px] font-bold uppercase tracking-[.06em] text-tomato-deep">Matches your craving</p>
      {[
        ['Chicken biriyani · half', 110],
        ['Chicken biriyani · full', 150],
        ['Beef biriyani · full', 150],
      ].map(([dish, cost]) => (
        <div key={dish} className="flex items-baseline gap-2 border-b border-line py-1.5 text-[13px] last:border-0">
          <span className="min-w-0 flex-1 font-semibold">{dish}</span>
          <span className="font-bold tabular-nums">₹{cost}</span>
        </div>
      ))}
    </div>
  );
}

function LocateStep({ locating, error, onLocate }: { locating: boolean; error: string; onLocate: () => void }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3" style={{ animation: 'fadeUp .7s ease .62s backwards' }}>
      <div
        className="flex flex-wrap items-center gap-3 rounded-[20px] bg-white p-2 pl-3"
        style={{ boxShadow: '0 18px 50px rgba(28,26,31,.10),0 0 0 1px #f1edf2' }}
      >
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-blush text-tomato">
          <LocateFixed size={21} strokeWidth={2.5} />
        </span>
        <div className="min-w-[150px] flex-1">
          <p className="m-0 text-[15px] font-bold text-ink">Where are you?</p>
          <p className="m-0 text-[13px] font-medium text-muted">Step 1 of 2, then tell YumFindAI what you're craving</p>
        </div>
        <button type="button" onClick={onLocate} disabled={locating} className="btn-primary h-12 flex-none px-[22px] max-sm:w-full">
          <LocateFixed size={16} strokeWidth={2.75} />
          {locating ? 'Finding you...' : 'Locate me'}
        </button>
      </div>
      {error ? (
        <p className="m-0 text-sm font-semibold text-[#d42a35]" style={{ animation: 'fadeUp .3s ease backwards' }}>
          {error}{' '}
          <Link to="/dashboard?pin=1" className="font-bold">
            Drop a pin on the map instead
          </Link>
        </p>
      ) : (
        <p className="m-0 text-[13px] font-medium text-faint">YumFindAI uses your location only to search near you.</p>
      )}
    </div>
  );
}

function HeroArt({
  mood,
  lookAt,
  bubble,
}: {
  mood: MascotMood;
  lookAt: { x: number; y: number } | null;
  bubble: { kind: string; text: string };
}) {
  return (
    <div className="relative aspect-[1/1.02] w-full max-w-[min(560px,92vw)] justify-self-center max-sm:max-w-[380px]" style={{ animation: 'fadeIn 1s ease .15s backwards' }}>
      <div
        className="absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px]"
        style={{
          background: 'radial-gradient(circle at 25% 15%,#ffe99a 0%,transparent 55%),linear-gradient(160deg,#ffd75e,#ffa91f)',
          boxShadow: '0 30px 60px rgba(255,169,31,.25)',
        }}
      />
      <div className="dot-grid absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px] opacity-60" />
      <div className="absolute left-0 top-[6%] aspect-square w-[24%]">
        <Photo eager src={foodImg('1565299624946-b28f40a0ae38', 320)} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 6s ease-in-out infinite' }} />
      </div>
      <div className="absolute right-[-2%] top-[52%] aspect-square w-[22%]">
        <Photo eager src={foodImg('1668236543090-82eba5ee5976', 320)} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 7s ease-in-out 1s infinite' }} />
      </div>
      <div className="absolute left-[19%] top-[15%] h-[76%] w-[66%]">
        <Mascot mood={mood} size="100%" follow lookAt={lookAt} />
      </div>
      <div
        className="absolute right-[3%] top-[3%] max-w-[54%] rounded-2xl bg-white px-3 py-2 text-[13px] font-semibold leading-snug text-ink sm:max-w-[50%] sm:px-4 sm:py-2.5 sm:text-[14px]"
        style={{ boxShadow: '0 16px 36px rgba(28,26,31,.14)', animation: 'popIn .5s cubic-bezier(.2,1.4,.4,1) .6s backwards' }}
        aria-hidden="true"
      >
        <span key={bubble.kind} className="block" style={{ animation: 'fadeIn .25s ease backwards' }}>
          {bubble.text}
        </span>
        <svg className="absolute -bottom-[10px] left-7" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
          <path d="M0 0H18L4 12Z" fill="#fff" />
        </svg>
      </div>
      <div
        className="absolute bottom-[4%] left-[2%] flex items-center gap-3 rounded-[20px] bg-white py-2.5 pl-2.5 pr-[18px] max-sm:hidden"
        style={{ boxShadow: '0 20px 44px rgba(28,26,31,.16)', animation: 'popIn .6s cubic-bezier(.2,1.4,.4,1) 1.05s backwards' }}
      >
        <span className="grid h-12 w-12 flex-none place-items-center rounded-full font-display text-lg font-bold text-ink" style={{ background: 'var(--grad-coin)' }}>
          A
        </span>
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#c2185b]">
            <Heart size={12} strokeWidth={2.75} className="fill-current" /> Your taste twin · 82% match
          </div>
          <div className="font-display text-[16px] font-semibold">"The mild dum biryani is spot on"</div>
        </div>
      </div>
      <div
        className="absolute bottom-[17%] right-[1%] flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-[13px] font-bold max-sm:hidden"
        style={{ boxShadow: '0 16px 36px rgba(28,26,31,.14)', animation: 'popIn .6s cubic-bezier(.2,1.4,.4,1) 1.3s backwards' }}
      >
        <BookOpen size={15} strokeWidth={2.5} className="text-tomato" />
        Chicken biriyani <span className="text-tomato-deep">₹150</span>
      </div>
    </div>
  );
}
