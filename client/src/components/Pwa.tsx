import { LogoMark } from '@/components/mascot/Mascot';
import { useIsPhone } from '@/lib/media';
import { Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const HOUR = 60 * 60 * 1000;
const DISMISS_KEY = 'yf-install-dismissed';
const DISMISS_MS = 14 * 24 * HOUR;

/** Chrome's install event; not in the DOM typings yet. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** True when running as the installed app (home-screen icon), not in a browser tab. */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function useOnline() {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('online', notify);
      window.addEventListener('offline', notify);
      return () => {
        window.removeEventListener('online', notify);
        window.removeEventListener('offline', notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

const pill = 'pointer-events-auto flex items-center gap-2.5 rounded-full bg-ink py-2 pl-3.5 pr-2 text-[13px] font-semibold text-white';
const pillStyle = { boxShadow: '0 14px 34px rgba(28,26,31,.28)', animation: 'sheetIn .45s cubic-bezier(.2,1.2,.4,1) backwards' };

/**
 * App-wide notices from the service worker: a new version is ready, or the device is offline.
 * Both stay out of the way until they have something to say.
 */
export function PwaNotices() {
  const online = useOnline();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // An open app checks for a new version every hour, not only on the next launch.
      if (registration) window.setInterval(() => void registration.update().catch(() => undefined), HOUR);
    },
  });

  if (online && !needRefresh) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(84px,calc(env(safe-area-inset-top)+80px))] z-[60] flex flex-col items-center gap-2 px-3 sm:top-[max(96px,calc(env(safe-area-inset-top)+92px))]">
      {!online ? (
        <div role="status" className={`${pill} pr-3.5`} style={pillStyle}>
          <WifiOff size={15} strokeWidth={2.5} className="flex-none text-sun" />
          You're offline. Searches need a connection.
        </div>
      ) : null}
      {needRefresh ? (
        <div role="status" className={pill} style={pillStyle}>
          <LogoMark size={20} className="flex-none" />
          New version ready
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-none px-3 text-[13px] font-bold text-white"
            style={{ background: 'var(--grad)' }}
          >
            <RefreshCw size={13} strokeWidth={2.75} />
            Update
          </button>
          <button
            type="button"
            aria-label="Later"
            onClick={() => setNeedRefresh(false)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border-none bg-white/10 text-white"
          >
            <X size={14} strokeWidth={2.75} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function recentlyDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS;
  } catch {
    return false;
  }
}

/**
 * "Add YumFindAI to your home screen", on phones only. Android gets the browser's install prompt;
 * iPhone Safari has none, so it gets the two taps to do instead. Hidden once installed or dismissed.
 */
export function InstallBanner() {
  const phone = useIsPhone();
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setHidden(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage blocked: it just shows again next visit.
    }
    setHidden(true);
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === 'accepted') setHidden(true);
  }

  if (!phone || hidden || (!prompt && !ios)) return null;
  return (
    <div
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-[22px] bg-white p-3 pr-2"
      style={{ boxShadow: '0 18px 48px rgba(28,26,31,.22), 0 0 0 1px #f1edf2', animation: 'sheetIn .5s cubic-bezier(.2,1.2,.4,1) 1.2s backwards' }}
      role="dialog"
      aria-label="Install YumFindAI"
    >
      <img src="/pwa-192x192.png" alt="" className="h-12 w-12 flex-none rounded-[14px]" />
      <div className="min-w-0 flex-1 leading-snug">
        <p className="m-0 text-sm font-bold text-ink">Install YumFindAI</p>
        {prompt ? (
          <p className="m-0 text-xs font-medium text-muted">Full screen, from your home screen.</p>
        ) : (
          <p className="m-0 text-xs font-medium text-muted">
            Tap <Share size={12} strokeWidth={2.5} className="inline -translate-y-px text-[#0a84ff]" /> Share, then <b className="text-ink-2">Add to Home Screen</b>.
          </p>
        )}
      </div>
      {prompt ? (
        <button type="button" onClick={() => void install()} className="btn-primary h-10 flex-none rounded-xl px-3.5 text-sm shadow-none">
          <Download size={15} strokeWidth={2.75} />
          Install
        </button>
      ) : null}
      <button type="button" aria-label="Not now" onClick={dismiss} className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full border-none bg-mist text-muted">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
