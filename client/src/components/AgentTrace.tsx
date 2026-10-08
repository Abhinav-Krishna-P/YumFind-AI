import type { MascotMood } from '@/components/mascot/Mascot';
import type { AgentStep } from '@/lib/api';
import { Check, Database, Globe, MapPin, MessageSquareText, Navigation, Sparkles } from 'lucide-react';

const ICONS: Record<string, typeof MapPin> = {
  search_places: MapPin,
  read_reviews: MessageSquareText,
  web_search: Globe,
  get_directions: Navigation,
  cache: Database,
};

const ENGINES: Record<string, string> = {
  search_places: 'google_maps',
  read_reviews: 'google_maps_reviews',
  web_search: 'google',
  get_directions: 'google_maps_directions',
  cache: 'cache',
};

// What the mascot does while the agent works: the running SerpApi call decides the pose.
const TOOL_MOOD: Record<string, MascotMood> = {
  search_places: 'searching',
  read_reviews: 'reading',
  web_search: 'thinking',
  get_directions: 'thinking',
  cache: 'happy',
};

export function agentMood(steps: AgentStep[] | null): MascotMood {
  const running = steps ? [...steps].reverse().find((step) => step.status === 'running') : undefined;
  return running ? TOOL_MOOD[running.tool] || 'thinking' : 'thinking';
}

/** The agent's live work log: one row per SerpApi call, filled in as events stream from the server. */
export function AgentTrace({ steps, compact = false, waiting = 'Planning the search' }: { steps: AgentStep[]; compact?: boolean; waiting?: string }) {
  if (!steps.length) {
    return (
      <div className="flex items-center gap-3 text-sm font-semibold text-muted">
        <Spinner />
        {waiting}
      </div>
    );
  }
  return (
    <ol className={`m-0 flex list-none flex-col p-0 ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
      {steps.map((step) => {
        const Icon = ICONS[step.tool] || Sparkles;
        const running = step.status === 'running';
        return (
          <li key={step.id} className="flex items-start gap-3" style={{ animation: 'fadeUp .35s ease backwards' }}>
            <span
              className={`grid h-7 w-7 flex-none place-items-center rounded-full ${running ? 'bg-blush text-tomato' : 'bg-[#e6f6ed] text-[#137a41]'}`}
              style={running ? { animation: 'listen 1.2s ease-in-out infinite' } : undefined}
            >
              {running ? <Icon size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1 leading-snug">
              <div className={`flex flex-wrap items-baseline gap-x-2 ${compact ? 'text-[13px]' : 'text-sm'} font-semibold text-ink`}>
                <span>{step.say}</span>
                <code className="rounded-md bg-mist px-1.5 py-px font-mono text-[10px] font-semibold text-faint">{ENGINES[step.tool] || step.tool}</code>
              </div>
              {step.status === 'done' && step.summary ? <div className="text-xs font-medium text-muted">{step.summary}</div> : null}
              {running ? (
                <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-muted">
                  <Spinner small /> working
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 4 : 5;
  return (
    <span className="flex flex-none gap-[3px]">
      {[0, 0.15, 0.3].map((delay) => (
        <span key={delay} className="rounded-full bg-tomato" style={{ width: size, height: size, animation: `dots 1s ease-in-out ${delay}s infinite` }} />
      ))}
    </span>
  );
}
