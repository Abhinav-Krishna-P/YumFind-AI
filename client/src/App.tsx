import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Dashboard } from '@/pages/Dashboard';
import { Home } from '@/pages/Home';
import { Login } from '@/pages/Login';
import { Profile } from '@/pages/Profile';
import { Signup } from '@/pages/Signup';

function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
  }, []);

  if (state === 'loading') {
    return <div className="grid h-dvh place-items-center bg-cream text-xl font-semibold">Finding your table...</div>;
  }
  if (state === 'out') return <Navigate to="/" replace />;
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
