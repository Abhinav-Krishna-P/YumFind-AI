import { AuthField, AuthMessages, AuthShell, AuthSubmit } from '@/components/AuthShell';
import { supabase } from '@/lib/supabase';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
    <AuthShell title="Sign up" onSubmit={onSubmit} switchLead="Already eating?" switchLabel="Log in" switchTo="/login">
      <AuthField label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
      <AuthField label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <AuthField
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <AuthMessages error={error} info={info} />
      <AuthSubmit busy={busy} label="Sign up" busyLabel="Creating..." />
    </AuthShell>
  );
}
