import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export function displayNameOf(session: Session | null) {
  const user = session?.user;
  if (!user) return '';
  const meta = user.user_metadata as { display_name?: string } | undefined;
  const raw = meta?.display_name || user.email?.split('@')[0] || 'Guest';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const name = displayNameOf(session);
  return { session, name, initial: (name.slice(0, 1) || 'A').toUpperCase() };
}
