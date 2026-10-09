/*
 * "Is it open when I get there?" from Google's weekly hours (SerpApi google_maps `operating_hours`),
 * e.g. { monday: "11 am–1 am", tuesday: "12–11 pm", sunday: "11 am–3 pm, 7–11 pm" }, and a drive time.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = 24 * 60;

type Span = { start: number; end: number };
type DayHours = Span[] | 'always';

export type Timing = { tone: 'good' | 'warn' | 'bad' | 'muted'; label: string };

function clockTime(text: string) {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!match) return null;
  return { hour: Number(match[1]) % 12, minute: Number(match[2] || 0), meridiem: match[3]?.toLowerCase() as 'a' | 'p' | undefined };
}

const toMinutes = (hour: number, minute: number, meridiem: 'a' | 'p') => (hour + (meridiem === 'p' ? 12 : 0)) * 60 + minute;

/** One day's text to minute spans; an end before its start runs past midnight. */
function parseDay(text: string): DayHours {
  const clean = text.toLowerCase().replace(/[  ]/g, ' ');
  if (/24 hours/.test(clean)) return 'always';
  if (/closed/.test(clean)) return [];
  const spans: Span[] = [];
  for (const part of clean.split(',')) {
    const [from, to] = part.split(/\s*(?:–|—|-|to)\s*/);
    const start = from ? clockTime(from) : null;
    const end = to ? clockTime(to) : null;
    if (!start || !end) continue;
    const endMeridiem = end.meridiem ?? 'p';
    const endMin = toMinutes(end.hour, end.minute, endMeridiem);
    // "12–11 pm" leaves the start's am/pm to the end's; "10–2 pm" has to mean 10 am.
    let startMin = toMinutes(start.hour, start.minute, start.meridiem ?? endMeridiem);
    if (!start.meridiem && startMin > endMin) startMin = toMinutes(start.hour, start.minute, endMeridiem === 'p' ? 'a' : 'p');
    spans.push({ start: startMin, end: endMin <= startMin ? endMin + DAY : endMin });
  }
  return spans;
}

function clock(minutes: number) {
  const m = ((minutes % DAY) + DAY) % DAY;
  const hour = Math.floor(m / 60);
  const minute = m % 60;
  const h12 = hour % 12 || 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour < 12 ? 'am' : 'pm'}`;
}

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Rough city drive time from straight-line distance, used until real directions are fetched. */
export function estimateDriveMin(distanceM: number | null) {
  if (distanceM == null) return null;
  return Math.max(3, Math.round(((distanceM * 1.4) / 1000 / 22) * 60));
}

/** "1 hr 5 min" / "12 min" from google_maps_directions to minutes. */
export function parseDuration(text: string | null | undefined) {
  if (!text) return null;
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] ?? 0);
  const minutes = Number(text.match(/(\d+)\s*min/i)?.[1] ?? 0);
  return hours || minutes ? hours * 60 + minutes : null;
}

export function timing(hours: Record<string, string> | null | undefined, driveMin: number | null, exact = false, now = new Date()): Timing | null {
  if (!hours) return null;
  const day = now.getDay();
  const today = hours[DAYS[day]] ? parseDay(hours[DAYS[day]]) : null;
  const yesterday = hours[DAYS[(day + 6) % 7]] ? parseDay(hours[DAYS[(day + 6) % 7]]) : null;
  const tomorrow = hours[DAYS[(day + 1) % 7]] ? parseDay(hours[DAYS[(day + 1) % 7]]) : null;
  if (!today) return null;
  if (today === 'always') return { tone: 'good', label: 'Open 24 hours' };

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const away = driveMin == null ? '' : `${exact ? '' : '~'}${duration(driveMin)} away`;
  // Spans open right now: today's, plus yesterday's that run past midnight.
  const spans = [...today, ...(Array.isArray(yesterday) ? yesterday.map((span) => ({ start: span.start - DAY, end: span.end - DAY })) : [])];
  const open = spans.find((span) => span.start <= nowMin && nowMin < span.end);

  if (open) {
    const left = open.end - nowMin;
    const closes = left < 120 ? `Closes in ${duration(left)}` : `Open till ${clock(open.end)}`;
    if (driveMin != null && driveMin >= left) return { tone: 'bad', label: `Closes in ${duration(left)}, before you'd get there` };
    if (driveMin != null && left - driveMin < 45) return { tone: 'warn', label: `${closes} · ${away}, cutting it close` };
    return { tone: 'good', label: `${closes}${away ? ` · ${away}` : ''}` };
  }

  const later = today.filter((span) => span.start > nowMin).sort((a, b) => a.start - b.start)[0];
  if (later) {
    const wait = later.start - nowMin;
    if (driveMin != null && wait <= driveMin) return { tone: 'warn', label: `Opens ${clock(later.start)}, about when you'd arrive` };
    return { tone: 'muted', label: `Closed now · opens ${clock(later.start)}` };
  }
  const next = Array.isArray(tomorrow) ? tomorrow[0] : tomorrow === 'always' ? { start: 0, end: DAY } : null;
  return { tone: 'muted', label: next ? `Closed now · opens ${clock(next.start)} tomorrow` : 'Closed now' };
}
