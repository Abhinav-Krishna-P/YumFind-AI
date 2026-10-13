import { useEffect, useSyncExternalStore } from 'react';

/** True while the CSS media query matches; updates on resize and rotation. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized screen: below Tailwind's `sm` breakpoint. */
export const useIsPhone = () => useMedia('(max-width: 639px)');

/**
 * Keeps `--app-height` equal to the visible viewport. On iOS the on-screen keyboard does not shrink
 * `100dvh`, so a full-height app would hide its bottom input behind the keyboard; this follows it.
 */
export function useAppHeight() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    const update = () => {
      // Pinch-zoom also shrinks the visual viewport; only follow the keyboard.
      if (Math.abs(view.scale - 1) > 0.01) return;
      root.style.setProperty('--app-height', `${Math.round(view.height)}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    update();
    view.addEventListener('resize', update);
    return () => {
      view.removeEventListener('resize', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
