import { AuthField, AuthMessages, AuthShell, AuthSubmit } from '@/components/AuthShell';
import { useSkipIfSignedIn } from '@/lib/session';
import { isRemembered, setRemember, supabase } from '@/lib/supabase';
import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function Login() {
  const navigate = useNavigate();
  const next = (useLocation().state as { next?: string } | null)?.next || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRememberChoice] = useState(isRemembered);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useSkipIfSignedIn(next);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    // Decide where the session is stored before Supabase writes it.
    setRemember(remember);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    navigate(next, { replace: true });
  }

  return (
    <AuthShell
      title="Log in"
      onSubmit={onSubmit}
      switchLead="New here?"
      switchLabel="Sign up"
      switchTo="/signup"
      status={busy ? 'busy' : error ? 'error' : undefined}
    >
      <AuthField label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <AuthField
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm font-semibold text-ink-2">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRememberChoice(event.target.checked)}
          className="h-[18px] w-[18px] flex-none cursor-pointer accent-tomato"
        />
        Remember me
        <span className="font-medium text-faint">· stay signed in on this device</span>
      </label>
      <AuthMessages error={error} />
      <AuthSubmit busy={busy} label="Log in" busyLabel="Checking..." />
    </AuthShell>
  );
}
