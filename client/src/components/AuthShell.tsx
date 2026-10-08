import { Logo, Photo, foodImg } from '@/components/brand';
import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

const bubble = (border: number): CSSProperties => ({
  border: `${border}px solid rgba(255,255,255,.9)`,
  boxShadow: '0 24px 50px rgba(80,10,20,.3)',
});

export function AuthShell({
  title,
  onSubmit,
  children,
  switchLead,
  switchLabel,
  switchTo,
}: {
  title: string;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  switchLead: string;
  switchLabel: string;
  switchTo: string;
}) {
  return (
    <main className="grid min-h-dvh grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]" style={{ animation: 'fadeIn .4s ease backwards' }}>
      <div className="flex flex-col justify-center px-[clamp(20px,6vw,96px)] py-10">
        <div className="self-start">
          <Logo size={36} text={22} />
        </div>
        <div className="mt-12 w-[min(420px,100%)]" style={{ animation: 'fadeUp .6s ease .05s backwards' }}>
          <h1 className="m-0 font-display text-[44px] font-bold tracking-[-.02em]">{title}</h1>
          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            {children}
          </form>
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
        style={{ background: 'radial-gradient(circle at 80% 10%,#ffe99a,transparent 50%),linear-gradient(150deg,#ff7a3d,#ff3d54)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 2px,transparent 2px)', backgroundSize: '24px 24px' }} />
        <div
          className="absolute left-[12%] top-[12%] aspect-square w-[46%] transition-[translate] duration-[400ms] ease-out"
          style={{ animation: 'popIn .7s cubic-bezier(.2,1.3,.4,1) .1s backwards' }}
        >
          <Photo
            src={foodImg('1585937421612-70a008356fbe')}
            className="h-full w-full rounded-full"
            style={{ ...bubble(8), boxShadow: '0 30px 60px rgba(80,10,20,.3)' }}
          />
        </div>
        <div
          className="absolute right-[10%] top-[34%] aspect-square w-[32%] transition-[translate] duration-300 ease-out"
          style={{ animation: 'popIn .7s cubic-bezier(.2,1.3,.4,1) .25s backwards' }}
        >
          <Photo src={foodImg('1488477181946-6428a0291777')} className="h-full w-full rounded-full" style={bubble(7)} />
        </div>
        <div
          className="absolute bottom-[10%] left-[22%] aspect-square w-[28%] transition-[translate] duration-300 ease-out"
          style={{ animation: 'popIn .7s cubic-bezier(.2,1.3,.4,1) .4s backwards' }}
        >
          <Photo src={foodImg('1601050690597-df0568f70950')} className="h-full w-full rounded-full" style={bubble(6)} />
        </div>
        <div
          className="absolute bottom-[12%] right-[8%] max-w-[240px] rounded-[18px] bg-white/95 px-4 py-3.5"
          style={{ boxShadow: '0 20px 44px rgba(80,10,20,.25)', animation: 'bob 4s ease-in-out infinite' }}
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
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
      {label}
      <input className="field" {...props} />
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
