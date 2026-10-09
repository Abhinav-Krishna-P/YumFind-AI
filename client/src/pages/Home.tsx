import { CATEGORIES, FoodRing, Logo, Photo, foodImg, useTitle } from '@/components/brand';
import { Mascot, useInputGaze, type MascotMood } from '@/components/mascot/Mascot';
import { SnapButton, type SnapState } from '@/components/SnapButton';
import { useSession } from '@/lib/session';
import { currentPosition, placeNameFor, readSpot, saveSpot, type Spot } from '@/lib/spot';
import { ArrowRight, BadgeCheck, Camera, Check, Heart, LocateFixed, MessageSquareText, Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const QUICK_PICKS = ['Mild chicken biryani', 'Spicy beef fry', 'Pure veg thali', 'Quiet cafe'];
const HEADLINE = ['Food', 'that', 'fits'];

const WHY = [
  {
    icon: Heart,
    title: 'Learns your taste',
    text: 'Mild or spicy, veg, family dinners, quick bites. YumFindAI remembers how you like it, so every search gets more personal.',
  },
  {
    icon: MessageSquareText,
    title: "Reads this month's reviews",
    text: 'Not a star average: what people said recently about the exact dish you want, at each place.',
  },
  {
    icon: BadgeCheck,
    title: 'Explains every match',
    text: "Each pick says why it suits you, which dishes reviewers love, and whether it's open when you get there.",
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
  const [snap, setSnap] = useState<SnapState>({ status: 'idle' });
  const input = useInputGaze();
  const justFound = foundAt > 0 && Date.now() - foundAt < 2400;

  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), 2600);
    return () => window.clearTimeout(id);
  }, []);

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

  /** Snap a dish: once Lens names it, show the name for a beat, then search for it. */
  function onSnap(state: SnapState) {
    setSnap(state);
    if (state.status !== 'done' || !state.dish) return;
    const dish = state.dish;
    setCraving(dish);
    window.setTimeout(() => pick(dish), 1100);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    pick(craving);
  }

  const typing = Boolean(input.focused);
  const where = town(spot?.label ?? null);
  let mood: MascotMood = 'idle';
  if (leaving || justFound || snap.status === 'done') mood = 'found';
  else if (locating || snap.status === 'working') mood = 'searching';
  else if (snap.status === 'error') mood = 'sad';
  else if (locError) mood = 'sad';
  else if (goHover) mood = 'happy';
  else if (typing) mood = 'curious';
  else if (greeting && !spot) mood = 'wave';

  let bubble = { kind: 'ask', text: `What are you in the mood for${where ? ` in ${where}` : ''}? I'll match it to your taste.` };
  if (snap.status === 'done' && snap.dish) bubble = { kind: 'snapped', text: `Looks like ${snap.dish}! Finding who makes it your way.` };
  else if (snap.status === 'working') bubble = { kind: 'snapping', text: 'Looking at your photo...' };
  else if (snap.status === 'error') bubble = { kind: 'snap-error', text: snap.message || "I couldn't tell what dish that is." };
  else if (leaving) bubble = { kind: 'go', text: 'On it! Reading the reviews.' };
  else if (locating) bubble = { kind: 'locating', text: 'Looking around for you...' };
  else if (locError) bubble = { kind: 'error', text: "I can't see where you are. Drop a pin on the map?" };
  else if (!spot) bubble = { kind: 'hello', text: "Hi, I'm YumFindAI. First, where are you?" };
  else if (justFound) bubble = { kind: 'found', text: `Found you${where ? ` in ${where}` : ''}! How do you like your food?` };
  else if (goHover) bubble = { kind: 'hover', text: "Let's eat!" };
  else if (craving.trim()) bubble = { kind: 'craving', text: `${short(craving)}? I'll find who makes it your way.` };
  else if (typing) bubble = { kind: 'typing', text: 'Type a dish. I read the newest reviews.' };

  return (
    <main className="min-h-dvh overflow-hidden bg-white" style={{ animation: 'fadeIn .5s ease backwards' }}>
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-line bg-white/80 px-[clamp(18px,4vw,56px)] py-4 backdrop-blur-[14px]">
        <Logo />
        <div className="ml-auto flex items-center gap-2.5">
          {session ? (
            <button
              onClick={() => navigate('/profile')}
              className="flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-line-2 bg-white py-[5px] pl-[5px] pr-3.5 text-sm font-semibold text-ink transition-[translate,border-color] duration-300 hover:border-tomato"
            >
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full font-display text-sm font-bold" style={{ background: 'var(--grad-coin)' }}>
                {initial}
              </span>
              Profile
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/signup')}
                className="cursor-pointer border-none bg-transparent px-3 py-2.5 text-[15px] font-semibold text-ink transition-colors hover:text-tomato"
              >
                Sign up
              </button>
              <button onClick={() => navigate('/login')} className="btn-primary px-[22px] py-[11px] hover:-translate-y-0.5">
                Log in
              </button>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto grid max-w-[1320px] grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-[clamp(32px,5vw,72px)] px-[clamp(18px,4vw,56px)] pb-10 pt-[clamp(32px,5vw,64px)]">
        <div className="flex max-w-[600px] flex-col gap-[22px]">
          <span
            className="inline-flex items-center gap-2 self-start rounded-full bg-blush py-[7px] pl-2 pr-3.5 text-[13px] font-bold text-tomato-deep"
            style={{ animation: 'fadeUp .6s ease backwards' }}
          >
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full text-white" style={{ background: 'var(--grad)' }}>
              <Sparkles size={12} strokeWidth={3} />
            </span>
            Not just nearby. Matched to your taste.
          </span>
          <h1 className="m-0 font-display text-[clamp(46px,6.4vw,84px)] font-bold leading-none tracking-[-.025em] [text-wrap:balance]">
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
          <p className="m-0 max-w-[480px] text-lg leading-relaxed text-muted [text-wrap:pretty]" style={{ animation: 'fadeUp .7s ease .5s backwards' }}>
            Google Maps lists everything around you. YumFindAI finds the few that fit you: it reads this month's reviews for the dish you want, remembers how you like it, and explains why each pick suits you.
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
                <Search className="ml-3 flex-none text-faint" size={20} strokeWidth={2.5} />
                <input
                  value={craving}
                  onChange={(event) => setCraving(event.target.value)}
                  placeholder="Mild chicken biryani, spicy beef fry..."
                  aria-label="What are you craving, and how do you like it?"
                  autoFocus={justFound}
                  className="min-w-0 flex-1 border-none bg-transparent px-1 py-3 text-base font-medium text-ink outline-none"
                  {...input.bind}
                />
                {session ? (
                  <SnapButton onChange={onSnap} className="h-[46px] w-[46px]" />
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate('/login', { state: { next: '/' } })}
                    aria-label="Log in to search by photo"
                    title="Log in to search by photo"
                    className="grid h-[46px] w-[46px] flex-none cursor-pointer place-items-center rounded-xl border-none bg-white text-tomato hover:bg-blush"
                    style={{ boxShadow: '0 2px 8px rgba(28,26,31,.08)' }}
                  >
                    <Camera size={19} strokeWidth={2.5} />
                  </button>
                )}
                <button
                  type="submit"
                  className="btn-primary flex-none px-[22px] py-3.5"
                  onPointerEnter={() => setGoHover(true)}
                  onPointerLeave={() => setGoHover(false)}
                >
                  Find food
                  <ArrowRight size={16} strokeWidth={2.75} />
                </button>
              </form>
              {snap.status === 'error' ? (
                <p className="m-0 text-sm font-semibold text-[#d42a35]" style={{ animation: 'fadeUp .3s ease backwards' }}>
                  {snap.message}
                </p>
              ) : (
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-medium text-faint">
                  <Camera size={14} strokeWidth={2.5} /> Saw something tasty? Snap or upload a photo and YumFindAI finds who makes it near you.
                </p>
              )}
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

      <section className="mx-auto max-w-[1320px] px-[clamp(18px,4vw,56px)] pb-4 pt-6">
        <h2 className="m-0 font-display text-[28px] font-semibold tracking-[-.01em]">Not another map. A match for your taste.</h2>
        <p className="m-0 mt-1 max-w-[640px] text-[15px] text-muted">A map shows what is near. YumFindAI works out what is right for you.</p>
        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
          {WHY.map(({ icon: Icon, title, text }, i) => (
            <div
              key={title}
              className="rounded-[22px] bg-white p-5"
              style={{ boxShadow: '0 0 0 1px #f1edf2', animation: `fadeUp .5s ease ${i * 80}ms backwards` }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: 'var(--grad)' }}>
                <Icon size={19} strokeWidth={2.5} />
              </span>
              <p className="m-0 mt-3 font-display text-lg font-semibold">{title}</p>
              <p className="m-0 mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-[clamp(18px,4vw,56px)] pb-20 pt-8">
        <h2 className="m-0 mb-[18px] font-display text-[28px] font-semibold tracking-[-.01em]">What are you craving?</h2>
        <div className="no-scrollbar flex gap-[clamp(14px,2.4vw,30px)] overflow-x-auto px-1 pb-3.5 pt-1.5">
          {CATEGORIES.map((category, i) => (
            <button
              key={category.label}
              onClick={() => pick(category.label)}
              className="flex flex-none cursor-pointer flex-col items-center gap-2.5 border-none bg-transparent p-0 text-[15px] font-semibold text-ink-2 transition-transform duration-300 [transition-timing-function:var(--spring)] hover:-translate-y-1.5"
              style={{ animation: `fadeUp .5s ease ${i * 50}ms backwards` }}
            >
              <FoodRing src={category.img} size="clamp(84px,9vw,116px)" />
              {category.label}
            </button>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(18px,4vw,56px)] py-6">
          <Logo size={30} text={18} />
          <p className="m-0 text-sm font-medium text-muted">YumFindAI finds food with live Google Maps, reviews, web and directions data from SerpApi.</p>
        </div>
      </footer>
    </main>
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
        <button type="button" onClick={onLocate} disabled={locating} className="btn-primary flex-none px-[22px] py-3.5 max-sm:w-full">
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
    <div className="relative aspect-[1/1.02] w-full max-w-[560px] justify-self-center" style={{ animation: 'fadeIn 1s ease .15s backwards' }}>
      <div
        className="absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px]"
        style={{
          background: 'radial-gradient(circle at 25% 15%,#ffe99a 0%,transparent 55%),linear-gradient(160deg,#ffd75e,#ffa91f)',
          boxShadow: '0 30px 60px rgba(255,169,31,.25)',
        }}
      />
      <div className="dot-grid absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px] opacity-60" />
      <div className="absolute left-0 top-[6%] aspect-square w-[24%]">
        <Photo src={foodImg('1565299624946-b28f40a0ae38')} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 6s ease-in-out infinite' }} />
      </div>
      <div className="absolute right-[-2%] top-[52%] aspect-square w-[22%]">
        <Photo src={foodImg('1668236543090-82eba5ee5976')} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 7s ease-in-out 1s infinite' }} />
      </div>
      <div className="absolute left-[19%] top-[15%] h-[76%] w-[66%]">
        <Mascot mood={mood} size="100%" follow lookAt={lookAt} />
      </div>
      <div
        className="absolute right-[3%] top-[3%] max-w-[50%] rounded-2xl bg-white px-4 py-2.5 text-[14px] font-semibold leading-snug text-ink"
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
        <Photo src={foodImg('1563379091339-03b21ab4a4f8')} className="h-14 w-14 rounded-[14px]" />
        <div>
          <div className="font-display text-[17px] font-semibold">Mild biryani, family-friendly</div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span className="rating-badge px-[7px] py-0.5">★ 4.5</span>
            Matches your taste
          </div>
        </div>
      </div>
    </div>
  );
}
