import { Logo, Photo, foodImg, useTitle } from '@/components/brand';
import { Mascot, useInputGaze, type MascotMood } from '@/components/mascot/Mascot';
import { createContext, useContext, useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Status = 'busy' | 'error' | 'success';

/** Fields report focus and caret position here so the mascot can react to them. */
const FieldGaze = createContext<ReturnType<typeof useInputGaze>['bind'] | null>(null);

function reaction(signup: boolean, status: Status | undefined, field: HTMLInputElement | null, greeting: boolean): { mood: MascotMood; says: string; kind: string } {
  if (status === 'busy') return { mood: 'thinking', says: signup ? 'Setting your table...' : 'Checking your details...', kind: 'busy' };
  if (field?.type === 'password') return { mood: 'shy', says: "I'm not looking. Promise!", kind: 'secret' };
  if (field) return { mood: 'curious', says: field.value ? 'Looking good so far.' : "Go on, I'm listening.", kind: field.value ? 'typed' : 'field' };
  if (status === 'error') return { mood: 'sad', says: "Hmm, that didn't work. Try again?", kind: 'error' };
  if (status === 'success') return { mood: 'happy', says: 'Check your inbox, then come back hungry!', kind: 'success' };
  if (signup) return { mood: greeting ? 'wave' : 'idle', says: "Nice to meet you! I'm YumFindAI.", kind: 'hello' };
  return { mood: greeting ? 'wave' : 'idle', says: 'Welcome back! Hungry?', kind: 'hello' };
}

export function AuthShell({
  title,
  onSubmit,
  children,
  switchLead,
  switchLabel,
  switchTo,
  status,
}: {
  title: string;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  switchLead: string;
  switchLabel: string;
  switchTo: string;
  status?: Status;
}) {
  useTitle(title);
  const gaze = useInputGaze();
  const [greeting, setGreeting] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), 2400);
    return () => window.clearTimeout(id);
  }, []);

  const field = gaze.focused;
  const { mood, says, kind } = reaction(title === 'Sign up', status, field, greeting);
  const lookAt = field && field.type !== 'password' ? gaze.point : null;

  return (
    <main className="grid min-h-dvh grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]" style={{ animation: 'fadeIn .4s ease backwards' }}>
      <div className="flex flex-col justify-center px-[clamp(20px,6vw,96px)] py-10">
        <div className="self-start">
          <Logo size={36} text={22} />
        </div>
        <div className="mt-12 w-[min(420px,100%)]" style={{ animation: 'fadeUp .6s ease .05s backwards' }}>
          <h1 className="m-0 font-display text-[44px] font-bold tracking-[-.02em]">{title}</h1>
          <FieldGaze.Provider value={gaze.bind}>
            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
              {children}
            </form>
          </FieldGaze.Provider>
          <p className="mb-0 mt-[22px] text-sm text-muted">
            {switchLead}{' '}
            <Link to={switchTo} className="font-bold">
              {switchLabel}
            </Link>
          </p>
        </div>
      </div>

      <div
        className="relative m-4 min-h-[520px] overflow-hidden rounded-[36px]"
        style={{ background: 'radial-gradient(circle at 80% 8%,#fff3b0,transparent 50%),linear-gradient(150deg,#ffd75e,#ffa91f)' }}
      >
        <div className="dot-grid absolute inset-0 opacity-70" />
        <div
          className="absolute right-[8%] top-[34%] aspect-square w-[28%]"
          style={{ animation: 'popIn .7s cubic-bezier(.2,1.3,.4,1) .25s backwards' }}
        >
          <Photo
            src={foodImg('1488477181946-6428a0291777')}
            className="h-full w-full rounded-full"
            style={{ border: '7px solid rgba(255,255,255,.95)', boxShadow: '0 24px 50px rgba(160,90,0,.25)' }}
          />
        </div>
        <div className="absolute left-[6%] top-[16%] h-[72%] w-[58%]">
          <Mascot mood={mood} size="100%" follow lookAt={lookAt} />
        </div>
        <div
          className="absolute left-[30%] top-[6%] max-w-[58%] rounded-2xl bg-white px-4 py-2.5 text-[15px] font-semibold leading-snug text-ink"
          style={{ boxShadow: '0 16px 36px rgba(160,90,0,.2)', animation: 'popIn .5s cubic-bezier(.2,1.4,.4,1) .3s backwards' }}
          aria-hidden="true"
        >
          <span key={kind} className="block" style={{ animation: 'fadeIn .25s ease backwards' }}>
            {says}
          </span>
          <svg className="absolute -bottom-[10px] left-6" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
            <path d="M0 0H18L4 12Z" fill="#fff" />
          </svg>
        </div>
        <div
          className="absolute bottom-[8%] right-[6%] max-w-[240px] rounded-[18px] bg-white/95 px-4 py-3.5"
          style={{ boxShadow: '0 20px 44px rgba(160,90,0,.22)', animation: 'bob 4s ease-in-out infinite' }}
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-leaf">
            <span className="rating-badge px-[7px] py-0.5">★ 4.6</span> Review report
          </div>
          <p className="mb-0 mt-1.5 text-[13px] text-ink-2">Positive, neutral and negative reviews from the last 3 months, sorted for you.</p>
        </div>
      </div>
    </main>
  );
}

export function AuthField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const gaze = useContext(FieldGaze);
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
      {label}
      <input className="field" {...props} {...gaze} />
    </label>
  );
}

export function AuthMessages({ error, info }: { error?: string; info?: string }) {
  return (
    <>
      {error ? (
        <p className="m-0 text-sm font-semibold text-[#d42a35]" style={{ animation: 'fadeUp .3s ease backwards' }}>
          {error}
        </p>
      ) : null}
      {info ? <p className="m-0 text-sm font-bold text-leaf">{info}</p> : null}
    </>
  );
}

export function AuthSubmit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy} className="btn-primary h-[54px] text-base">
      {busy ? busyLabel : label}
    </button>
  );
}
