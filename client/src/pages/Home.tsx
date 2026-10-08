import { CATEGORIES, FoodRing, Logo, Photo, foodImg, useTitle } from '@/components/brand';
import { Mascot, useInputGaze, type MascotMood } from '@/components/mascot/Mascot';
import { useSession } from '@/lib/session';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

const QUICK_PICKS = ['Biryani', 'Filter coffee', 'Pure veg', 'Rooftop cafe'];
const HEADLINE = ['Find', 'a', 'place', 'to'];

const floatCircle: CSSProperties = {
  border: '6px solid #fff',
  boxShadow: '0 16px 36px rgba(28,26,31,.2)',
};

function short(text: string, max = 22) {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function Home() {
  useTitle();
  const navigate = useNavigate();
  const { session, initial } = useSession();
  const [craving, setCraving] = useState('');
  const [greeting, setGreeting] = useState(true);
  const [goHover, setGoHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const input = useInputGaze();

  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), 2600);
    return () => window.clearTimeout(id);
  }, []);

  function pick(label: string) {
    const target = `/dashboard${label.trim() ? `?q=${encodeURIComponent(label.trim())}` : ''}`;
    setLeaving(true);
    // A short beat so the mascot's cheer is visible before the page changes.
    window.setTimeout(() => navigate(session ? target : '/login', session ? undefined : { state: { next: target } }), 380);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    pick(craving);
  }

  const typing = Boolean(input.focused);
  const mood: MascotMood = leaving ? 'found' : goHover ? 'happy' : typing ? 'curious' : greeting ? 'wave' : 'idle';
  const bubble = leaving
    ? { kind: 'go', text: 'On it! Reading the reviews.' }
    : goHover
      ? { kind: 'hover', text: "Let's eat!" }
      : craving.trim()
        ? { kind: 'craving', text: `${short(craving)}? Good call. I'll check who makes it best.` }
        : typing
          ? { kind: 'typing', text: 'Type a dish. I read the newest reviews.' }
          : { kind: 'hello', text: "Hi, I'm YumFindAI. What are you craving?" };

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
            An agent that reads the reviews for you
          </span>
          <h1 className="m-0 font-display text-[clamp(46px,6.4vw,84px)] font-bold leading-none tracking-[-.025em] [text-wrap:balance]">
            {HEADLINE.map((word, i) => (
              <span key={word} className="inline-block" style={{ animation: `blurIn .8s cubic-bezier(.2,.7,.2,1) ${0.05 + i * 0.07}s backwards` }}>
                {word}&nbsp;
              </span>
            ))}
            <span className="relative inline-block" style={{ animation: 'blurIn .8s cubic-bezier(.2,.7,.2,1) .33s backwards' }}>
              eat
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
              nearby.
            </span>
          </h1>
          <p className="m-0 max-w-[480px] text-lg leading-relaxed text-muted [text-wrap:pretty]" style={{ animation: 'fadeUp .7s ease .5s backwards' }}>
            Say what you are craving. YumFindAI searches Google Maps, reads the newest reviews, cross-checks the web, and ranks only what the evidence supports.
          </p>
          <form
            onSubmit={onSearch}
            className="flex max-w-[560px] items-center gap-2 rounded-[20px] bg-white p-2"
            style={{ boxShadow: '0 18px 50px rgba(28,26,31,.10),0 0 0 1px #f1edf2', animation: 'fadeUp .7s ease .62s backwards' }}
          >
            <Search className="ml-3 flex-none text-faint" size={20} strokeWidth={2.5} />
            <input
              value={craving}
              onChange={(event) => setCraving(event.target.value)}
              placeholder="Biryani, cafe, or hotel"
              aria-label="What are you craving?"
              className="min-w-0 flex-1 border-none bg-transparent px-1 py-3 text-base font-medium text-ink outline-none"
              {...input.bind}
            />
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
          <div className="flex flex-wrap gap-2" style={{ animation: 'fadeUp .7s ease .74s backwards' }}>
            {QUICK_PICKS.map((label) => (
              <button key={label} className="pill-link" onClick={() => pick(label)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <HeroArt mood={mood} lookAt={input.point} bubble={bubble} />
      </section>

      <section className="mx-auto max-w-[1320px] px-[clamp(18px,4vw,56px)] pb-20 pt-6">
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
          <div className="font-display text-[17px] font-semibold">Biryani tonight?</div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span className="rating-badge px-[7px] py-0.5">★ 4.5</span>
            Ranked from recent reviews
          </div>
        </div>
      </div>
    </div>
  );
}
