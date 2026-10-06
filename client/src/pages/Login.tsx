import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    navigate('/dashboard');
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-50 px-4">
      <Card className="w-full max-w-md">
        <Link className="text-lg font-semibold" to="/">
          YumFindAI
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Log in</h1>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? 'Checking...' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-sm">
          New here?{' '}
          <Link className="font-semibold underline" to="/signup">
            Sign up
          </Link>
        </p>
      </Card>
    </main>
  );
}
