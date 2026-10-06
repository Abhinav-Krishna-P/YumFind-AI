import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function Signup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    if (data.session) {
      navigate('/dashboard');
      return;
    }
    setInfo('Check your email to confirm, then log in.');
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-50 px-4">
      <Card className="w-full max-w-md">
        <Link className="text-lg font-semibold" to="/">
          YumFindAI
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Sign up</h1>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {info ? <p className="text-sm font-semibold">{info}</p> : null}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? 'Creating...' : 'Sign up'}
          </Button>
        </form>
        <p className="mt-4 text-sm">
          Already eating?{' '}
          <Link className="font-semibold underline" to="/login">
            Log in
          </Link>
        </p>
      </Card>
    </main>
  );
}
