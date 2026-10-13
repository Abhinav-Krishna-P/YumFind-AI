import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Mascot } from '@/components/mascot/Mascot';
import { PwaNotices } from '@/components/Pwa';
import { supabase } from '@/lib/supabase';
import { Home } from '@/pages/Home';

// Only the landing page ships in the first download. The map page pulls in MapLibre (~1 MB),
// so phones on the home page never pay for it until they open the map.
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.Profile })));
const Login = lazy(() => import('@/pages/Login').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('@/pages/Signup').then((m) => ({ default: m.Signup })));

function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center" style={{ animation: 'fadeIn .3s ease backwards' }}>
      <div className="flex flex-col items-center gap-3">
        <Mascot mood="searching" size={150} interactive={false} />
        <p className="m-0 font-display text-[26px] font-semibold">Finding your table...</p>
      </div>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const location = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
  }, []);

  if (state === 'loading') return <Loading />;
  // After logging in, carry on to the page (and query) that was asked for.
  if (state === 'out') return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  return (
    <>
    <PwaNotices />
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
      </Routes>
    </Suspense>
    </>
  );
}
