import { BlurText, PopIn } from '@/components/bits/PopIn';
import { buttonVariants } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export function Home() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold">YumFindAI</span>
        {session ? (
          <Link className={buttonVariants({ variant: 'outline' })} to="/profile">
            Profile
          </Link>
        ) : null}
      </header>
      <section className="mx-auto flex max-w-xl flex-col gap-5 px-6 py-20">
        <h1 className="text-4xl font-semibold tracking-tight">
          <BlurText text="Find a place to eat nearby." />
        </h1>
        <p className="text-zinc-600">
          Locate yourself, search for a dish, and open a restaurant to see its photo, rating, and recent reviews.
        </p>
        <PopIn className="flex flex-wrap gap-3">
          {session ? (
            <Link className={buttonVariants()} to="/dashboard">
              Open the map
            </Link>
          ) : (
            <>
              <Link className={buttonVariants()} to="/login">
                Log in
              </Link>
              <Link className={buttonVariants({ variant: 'outline' })} to="/signup">
                Sign up
              </Link>
            </>
          )}
        </PopIn>
      </section>
    </main>
  );
}
