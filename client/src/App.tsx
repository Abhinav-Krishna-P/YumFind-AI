import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { Photo, foodImg } from '@/components/brand';
import { supabase } from '@/lib/supabase';
import { Dashboard } from '@/pages/Dashboard';
import { Home } from '@/pages/Home';
import { Login } from '@/pages/Login';
import { Profile } from '@/pages/Profile';
import { Signup } from '@/pages/Signup';

function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center" style={{ animation: 'fadeIn .3s ease backwards' }}>
      <div className="flex flex-col items-center gap-[22px]">
        <div className="h-[110px] w-[110px] rounded-full p-[5px]" style={{ background: 'var(--grad-ring)', animation: 'bob 1.2s ease-in-out infinite' }}>
          <Photo
            src={foodImg('1563379091339-03b21ab4a4f8')}
            className="h-full w-full rounded-full border-4 border-white"
          />
        </div>
        <p className="m-0 font-display text-[26px] font-semibold">Finding your table...</p>
      </div>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
  }, []);

  if (state === 'loading') return <Loading />;
  if (state === 'out') return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
    </Routes>
  );
}
