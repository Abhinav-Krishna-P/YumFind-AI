import { CATEGORIES, FoodRing, LiveDot, Logo, Photo, foodImg } from '@/components/brand';
import { useSession } from '@/lib/session';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

const QUICK_PICKS = ['Biryani', 'Filter coffee', 'Pure veg', 'Rooftop cafe'];
const HEADLINE = ['Find', 'a', 'place', 'to'];

const floatCircle: CSSProperties = {
  border: '6px solid #fff',
  boxShadow: '0 16px 36px rgba(28,26,31,.2)',
};

export function Home() {
  const navigate = useNavigate();
  const { session, initial } = useSession();
  const [craving, setCraving] = useState('');

  function pick(label: string) {
    const target = `/dashboard${label.trim() ? `?q=${encodeURIComponent(label.trim())}` : ''}`;
    navigate(session ? target : '/login', session ? undefined : { state: { next: target } });
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    pick(craving);
  }

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
            Say what you are craving. YumAI searches Google Maps, reads the newest reviews, cross-checks the web, and ranks only what the evidence supports.
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
              className="min-w-0 flex-1 border-none bg-transparent px-1 py-3 text-base font-medium text-ink outline-none"
            />
            <button type="submit" className="btn-primary flex-none px-[22px] py-3.5">
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

        <HeroArt />
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
    </main>
  );
}

function HeroArt() {
  return (
    <div className="relative aspect-[1/1.02] w-full max-w-[560px] justify-self-center" style={{ animation: 'fadeIn 1s ease .15s backwards' }}>
      <div
        className="absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px] transition-[translate] duration-[400ms] ease-out"
        style={{
          background: 'radial-gradient(circle at 25% 15%,#ffe99a 0%,transparent 55%),linear-gradient(160deg,#ffd75e,#ffa91f)',
          boxShadow: '0 30px 60px rgba(255,169,31,.25)',
        }}
      />
      <div className="dot-grid absolute bottom-0 left-[8%] right-0 top-[4%] rounded-[40px] opacity-60" />
      <div className="absolute left-[18%] top-[15%] aspect-square w-[68%] transition-[translate] duration-[400ms] ease-out">
        <div className="h-full w-full rounded-full bg-white p-3" style={{ boxShadow: '0 30px 60px rgba(28,26,31,.22)' }}>
          <Photo
            src={foodImg('1645177628172-a94c1f96e6db')}
            className="h-full w-full rounded-full"
          />
        </div>
      </div>
      <div className="absolute left-0 top-[6%] aspect-square w-[26%] transition-[translate] duration-300 ease-out">
        <Photo src={foodImg('1565299624946-b28f40a0ae38')} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 6s ease-in-out infinite' }} />
      </div>
      <div className="absolute right-[-2%] top-[44%] aspect-square w-[24%] transition-[translate] duration-300 ease-out">
        <Photo src={foodImg('1668236543090-82eba5ee5976')} className="h-full w-full rounded-full" style={{ ...floatCircle, animation: 'bob 7s ease-in-out 1s infinite' }} />
      </div>
      <div
        className="absolute right-[8%] top-0 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-2.5 text-[13px] font-bold transition-[translate] duration-300 ease-out"
        style={{ boxShadow: '0 16px 36px rgba(28,26,31,.14)', animation: 'popIn .6s cubic-bezier(.2,1.4,.4,1) .9s backwards' }}
      >
        <LiveDot color="#1fa45a" />
        Reading 24 recent reviews
      </div>
      <div
        className="absolute bottom-[4%] left-[2%] flex items-center gap-3 rounded-[20px] bg-white py-2.5 pl-2.5 pr-[18px] transition-[translate,transform] duration-300 ease-out"
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
