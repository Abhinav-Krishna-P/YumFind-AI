import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const REMEMBER_KEY = 'yf-remember';

export const supabaseReady = Boolean(url && key);

/** "Remember me": keep the session in localStorage (survives restarts) or sessionStorage (ends with the browser). */
export function setRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    // Storage blocked: Supabase falls back to an in-memory session.
  }
}

export function isRemembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

const sessionStore: SupportedStorage = {
  getItem(name) {
    try {
      const [first, second] = isRemembered() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
      return first.getItem(name) ?? second.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      const keep = isRemembered();
      (keep ? localStorage : sessionStorage).setItem(name, value);
      (keep ? sessionStorage : localStorage).removeItem(name);
    } catch {
      // Storage blocked: nothing to persist.
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
    } catch {
      // Storage blocked: nothing to remove.
    }
  },
};

export const supabase = createClient(url || 'http://127.0.0.1:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, storage: sessionStore },
});
