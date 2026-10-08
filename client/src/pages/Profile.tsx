import { Logo, Photo, useTitle } from '@/components/brand';
import { Mascot } from '@/components/mascot/Mascot';
import { supabase } from '@/lib/supabase';
import { LogOut, Map as MapIcon, Utensils } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

type PlaceRef = { name: string; thumbnail: string | null };
type Visit = { visited_at: string; places: PlaceRef | PlaceRef[] | null };

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function Profile() {
  useTitle('Profile');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [searches, setSearches] = useState(0);
  const [opened, setOpened] = useState(0);
  const [visits, setVisits] = useState<{ name: string; thumbnail: string | null; at: Date }[]>([]);

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
      const { count: visitCount } = await supabase.from('place_visits').select('id', { count: 'exact', head: true });
      setOpened(visitCount || 0);
      const { data: rows } = await supabase
        .from('place_visits')
        .select('visited_at, places(name, thumbnail)')
        .order('visited_at', { ascending: false })
        .limit(10);
      setVisits(
        ((rows || []) as Visit[]).map((row) => {
          const place = Array.isArray(row.places) ? row.places[0] : row.places;
          return { name: place?.name || 'Place', thumbnail: place?.thumbnail ?? null, at: new Date(row.visited_at) };
        }),
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
    <main className="min-h-dvh bg-mist" style={{ animation: 'fadeIn .4s ease backwards' }}>
      <header className="sticky top-0 z-30 border-b border-line bg-white/[.85] backdrop-blur-[14px]">
        <div className="mx-auto flex max-w-[1080px] items-center gap-4 px-[clamp(18px,4vw,40px)] py-3.5">
          <Logo size={34} text={20} />
          <Link to="/dashboard" className="btn-outline ml-auto h-10 px-4 no-underline hover:text-tomato">
            <MapIcon size={15} strokeWidth={2.5} />
            Back to map
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1080px] items-start gap-6 px-[clamp(18px,4vw,40px)] py-8 md:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-4" style={{ animation: 'fadeUp .5s ease backwards' }}>
          <section className="overflow-hidden rounded-[22px] bg-white" style={{ boxShadow: '0 0 0 1px #f1edf2' }}>
            <div className="relative h-20" style={{ background: 'linear-gradient(135deg,#ff7a3d,#ff3d54)' }}>
              <div className="absolute -bottom-7 right-5">
                <Mascot mood="idle" greet size={92} outline follow steam={false} shadow={false} />
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="relative z-10 -mt-10 h-20 w-20 rounded-full bg-white p-1" style={{ boxShadow: '0 8px 20px rgba(28,26,31,.12)' }}>
                {avatar ? (
                  <img className="h-full w-full rounded-full object-cover" src={avatar} alt="" />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-full font-display text-[32px] font-bold text-ink" style={{ background: 'var(--grad-coin)' }}>
                    {initial}
                  </div>
                )}
              </div>
              <h1 className="m-0 mt-3 break-words font-display text-[26px] font-bold leading-tight">{name}</h1>
              <p className="m-0 mt-0.5 break-all text-sm font-medium text-muted">{email}</p>
              <button onClick={() => void signOut()} className="btn-outline mt-5 h-10 w-full">
                <LogOut size={15} strokeWidth={2.5} />
                Sign out
              </button>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <Stat label="Searches" value={searches} />
            <Stat label="Places opened" value={opened} />
          </div>
        </aside>

        <section className="rounded-[22px] bg-white p-6" style={{ boxShadow: '0 0 0 1px #f1edf2', animation: 'fadeUp .5s ease .08s backwards' }}>
          <h2 className="m-0 font-display text-[22px] font-semibold">Recent visits</h2>
          <p className="m-0 mt-0.5 text-sm text-muted">Places you opened on the map.</p>
          {visits.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl bg-mist px-4 py-6 text-center">
              <Mascot mood="curious" size={96} follow steam={false} />
              <p className="m-0 text-muted">No visits yet. Open a place on the map and YumFindAI will remember it here.</p>
            </div>
          ) : (
            <ul className="m-0 mt-4 list-none divide-y divide-line p-0">
              {visits.map((visit) => (
                <li key={`${visit.name}-${visit.at.getTime()}`} className="flex items-center gap-4 py-3">
                  {visit.thumbnail ? (
                    <Photo src={visit.thumbnail} className="h-12 w-12 flex-none rounded-xl" />
                  ) : (
                    <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-peach text-tomato">
                      <Utensils size={20} strokeWidth={2.25} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{visit.name}</span>
                  <span className="flex-none text-right text-[13px] leading-tight text-muted">
                    {dateFormat.format(visit.at)}
                    <br />
                    <span className="text-faint">{timeFormat.format(visit.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[22px] bg-white px-5 py-4" style={{ boxShadow: '0 0 0 1px #f1edf2' }}>
      <p className="m-0 text-[13px] font-semibold text-muted">{label}</p>
      <p className="m-0 mt-1 font-display text-[36px] font-bold leading-none text-ink">{value}</p>
    </div>
  );
}
