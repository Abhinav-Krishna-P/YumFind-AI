import { AuthField, AuthMessages, AuthShell, AuthSubmit } from '@/components/AuthShell';
import { supabase } from '@/lib/supabase';
import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function Login() {
  const navigate = useNavigate();
  const next = (useLocation().state as { next?: string } | null)?.next || '/dashboard';
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
    navigate(next);
  }

  return (
    <AuthShell title="Log in" onSubmit={onSubmit} switchLead="New here?" switchLabel="Sign up" switchTo="/signup">
      <AuthField label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <AuthField
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <AuthMessages error={error} />
      <AuthSubmit busy={busy} label="Log in" busyLabel="Checking..." />
    </AuthShell>
  );
}
