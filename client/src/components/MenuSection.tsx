import { Mascot } from '@/components/mascot/Mascot';
import { api, type Menu, type MenuItem } from '@/lib/api';
import { BookOpen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

/** "biryani" ~ "biriyani": compare words without vowels so local spellings still match. */
const skeleton = (word: string) => word.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');

function wordsOf(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4)
    .map(skeleton)
    .filter((word) => word.length >= 2);
}

function matches(item: MenuItem, wanted: string[]) {
  if (!wanted.length) return false;
  const have = new Set(wordsOf(item.name));
  return wanted.some((word) => have.has(word));
}

const price = (value: number | null) => (value == null ? '—' : `₹${value}`);

function Row({ item, highlight = false }: { item: MenuItem; highlight?: boolean }) {
  return (
    <li className={`flex items-baseline gap-2 py-1.5 text-sm ${highlight ? 'font-bold text-ink' : 'text-ink-2'}`}>
      <span className="min-w-0 flex-1">{item.name}</span>
      <span className="flex-none border-b border-dotted border-line-2" style={{ width: 24 }} />
      <span className={`flex-none tabular-nums ${item.price == null ? 'text-faint' : 'font-bold text-ink'}`}>{price(item.price)}</span>
    </li>
  );
}

/**
 * Menu & prices: the restaurant's Google Maps menu photos, read into a searchable price list.
 * Loaded on demand (one SerpApi call plus a vision read the first time; cached 14 days after that).
 */
export function MenuSection({ placeId, craving }: { placeId: string; craving: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  async function load() {
    setStatus('loading');
    setError('');
    try {
      setMenu(await api<Menu>('/api/place/menu', { placeId }));
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the menu.");
      setStatus('error');
    }
  }

  const wanted = useMemo(() => wordsOf(craving), [craving]);
  const items = menu?.items ?? [];
  const filtered = query.trim() ? items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())) : items;
  const forYou = query.trim() ? [] : items.filter((item) => matches(item, wanted)).slice(0, 6);
  const shown = all || query.trim() ? filtered : filtered.slice(0, 30);
  const sections = new Map<string, MenuItem[]>();
  for (const item of shown) {
    const section = item.section || 'Menu';
    sections.set(section, [...(sections.get(section) ?? []), item]);
  }

  return (
    <section className="mt-4 rounded-2xl border-[1.5px] border-line p-3.5">
      <p className="m-0 flex items-center gap-1.5 font-display text-[17px] font-semibold text-ink">
        <BookOpen size={16} strokeWidth={2.5} className="text-tomato" />
        Menu &amp; prices
      </p>

      {status === 'idle' ? (
        <>
          <p className="m-0 mt-0.5 text-xs font-medium text-muted">Read from the menu photos posted on Google Maps.</p>
          <button type="button" onClick={() => void load()} className="btn-primary mt-3 h-10 w-full rounded-xl text-sm shadow-none">
            <BookOpen size={15} strokeWidth={2.5} />
            See menu &amp; prices
          </button>
        </>
      ) : null}

      {status === 'loading' ? (
        <div className="mt-2 flex items-center gap-3">
          <Mascot mood="reading" size={56} steam={false} shadow={false} interactive={false} className="flex-none" />
          <p className="m-0 text-sm font-semibold text-ink-2">Reading the menu photos... this takes about 15 seconds the first time.</p>
        </div>
      ) : null}

      {status === 'error' ? <p className="m-0 mt-2 text-sm font-semibold text-[#d42a35]">{error}</p> : null}

      {status === 'done' && menu ? (
        <div style={{ animation: 'fadeUp .35s ease backwards' }}>
          {menu.photos.length ? (
            <div className="no-scrollbar -mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1">
              {menu.photos.map((photo, index) => (
                <a key={photo.thumb} href={photo.image} target="_blank" rel="noreferrer" className="flex-none" aria-label={`Open menu photo ${index + 1}`}>
                  <img src={photo.thumb} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-xl object-cover" />
                </a>
              ))}
            </div>
          ) : null}

          {items.length ? (
            <>
              <label className="mt-3 flex items-center gap-2 rounded-xl bg-mist px-3 py-2">
                <Search size={15} strokeWidth={2.5} className="flex-none text-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Find a dish (${items.length} on the menu)`}
                  aria-label="Find a dish on the menu"
                  className="min-w-0 flex-1 border-none bg-transparent text-sm font-medium text-ink outline-none"
                />
              </label>

              {forYou.length ? (
                <div className="mt-3 rounded-xl bg-peach px-3 py-1.5">
                  <p className="m-0 pt-1 text-[11px] font-bold uppercase tracking-[.06em] text-tomato-deep">Matches your craving</p>
                  <ul className="m-0 list-none p-0">
                    {forYou.map((item) => (
                      <Row key={`fy-${item.name}-${item.price}`} item={item} highlight />
                    ))}
                  </ul>
                </div>
              ) : null}

              {[...sections.entries()].map(([section, rows]) => (
                <div key={section} className="mt-3">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[.06em] text-faint">{section}</p>
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {rows.map((item) => (
                      <Row key={`${section}-${item.name}-${item.price}`} item={item} highlight={matches(item, wanted)} />
                    ))}
                  </ul>
                </div>
              ))}

              {!query.trim() && filtered.length > 30 ? (
                <button
                  type="button"
                  onClick={() => setAll((value) => !value)}
                  className="mt-2 cursor-pointer border-none bg-transparent p-0 text-xs font-bold text-tomato hover:underline"
                >
                  {all ? 'Show less' : `Show all ${filtered.length} dishes`}
                </button>
              ) : null}
              {query.trim() && !filtered.length ? <p className="m-0 mt-2 text-sm text-muted">No dish on the menu matches "{query}".</p> : null}
              <p className="m-0 mt-3 text-[11px] font-medium text-faint">
                Read from {menu.read} menu photo{menu.read === 1 ? '' : 's'} on Google Maps. Prices as printed; menus change, so check at the restaurant.
              </p>
            </>
          ) : (
            <p className="m-0 mt-2 text-sm text-muted">
              {menu.photos.length ? "The photos here don't show a readable menu." : 'No menu photos on Google Maps for this place yet.'}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
