import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

type Visit = { visited_at: string; places: { name: string } | { name: string }[] | null };

export function Profile() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [searches, setSearches] = useState(0);
  const [visits, setVisits] = useState<{ name: string; at: string }[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;
      setEmail(user.email || '');
      const { data: profile } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
      setName(profile?.display_name || user.email?.split('@')[0] || 'Guest');
      setAvatar(profile?.avatar_url ?? null);
      const { count } = await supabase.from('searches').select('id', { count: 'exact', head: true });
      setSearches(count || 0);
      const { data: rows } = await supabase
        .from('place_visits')
        .select('visited_at, places(name)')
        .order('visited_at', { ascending: false })
        .limit(10);
      setVisits(
        ((rows || []) as Visit[]).map((row) => ({
          name: Array.isArray(row.places) ? row.places[0]?.name || 'Place' : row.places?.name || 'Place',
          at: new Date(row.visited_at).toLocaleString(),
        })),
      );
    }
    void load();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/');
  }

  const initial = name.slice(0, 1).toUpperCase();

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 text-zinc-900">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link className="text-lg font-semibold" to="/">
            YumFindAI
          </Link>
          <Link className="font-semibold underline" to="/dashboard">
            Map
          </Link>
        </div>
        <Card className="flex items-center gap-4">
          {avatar ? (
            <img className="h-16 w-16 rounded-full border-2 border-ink object-cover" src={avatar} alt="" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-zinc-900 text-2xl font-semibold text-white">
              {initial}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p>{email}</p>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">Searches</p>
          <p className="text-5xl font-semibold">{searches}</p>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold">Recent visits</h2>
          {visits.length === 0 ? (
            <p className="mt-3">No visits yet. Open a place on the map.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {visits.map((visit) => (
                <li key={`${visit.name}-${visit.at}`} className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                  <span className="font-semibold">{visit.name}</span>
                  <span className="text-sm">{visit.at}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
