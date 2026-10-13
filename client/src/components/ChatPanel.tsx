import { AgentTrace, agentMood } from '@/components/AgentTrace';
import { LogoMark, Mascot, useInputGaze, type MascotMood } from '@/components/mascot/Mascot';
import { apiCall, apiStream, upsertStep, type AgentStep, type ChatMessage, type RunUsage, type TraceStep } from '@/lib/api';
import { ArrowUp, MapPin, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export type ChatAnswer = {
  answer: string;
  headline: string;
  reason: string;
  placeId: string | null;
  verdict: string | null;
  trace: TraceStep[];
  usage?: RunUsage;
  messages?: ChatMessage[];
  memory?: string[];
};

const STARTERS = ['Which one is least spicy?', 'Best for a family dinner?', 'Which has parking?', 'Closest by road?'];

const asSteps = (steps: TraceStep[]): AgentStep[] =>
  steps.map((step, index) => ({ id: index + 1, tool: step.tool, say: step.say, status: 'done', summary: step.summary }));

/**
 * "Ask about these": a chat with the agent about one result set. History and taste memory are stored
 * server-side in Redis, so the chat survives closing the panel or reloading the page.
 */
export function ChatPanel({
  fingerprint,
  placeCount,
  user,
  onClose,
  onShowPlace,
  onAnswer,
}: {
  fingerprint: string;
  placeCount: number;
  user: { lat: number; lng: number } | null;
  onClose: () => void;
  onShowPlace: (id: string) => void;
  onAnswer: (answer: ChatAnswer) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memory, setMemory] = useState<string[]>([]);
  const [store, setStore] = useState<'redis' | 'memory' | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ question: string; steps: AgentStep[] } | null>(null);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useInputGaze();

  useEffect(() => {
    let live = true;
    setLoading(true);
    apiCall<{ messages: ChatMessage[]; memory: string[]; store: 'redis' | 'memory' }>('GET', `/api/agent/chat?fingerprint=${encodeURIComponent(fingerprint)}`)
      .then((data) => {
        if (!live) return;
        setMessages(data.messages);
        setMemory(data.memory);
        setStore(data.store);
      })
      .catch(() => live && setMessages([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [fingerprint]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, error]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setDraft('');
    setError('');
    setPending({ question, steps: [] });
    try {
      const result = await apiStream<ChatAnswer>(
        '/api/agent/followup',
        { fingerprint, question, lat: user?.lat, lng: user?.lng },
        (event) => {
          if (event.type === 'step') setPending((current) => current && { ...current, steps: upsertStep(current.steps, event) });
        },
      );
      setMessages((current) => [...current, ...(result.messages ?? [])]);
      if (result.memory) setMemory(result.memory);
      onAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YumFindAI could not answer that');
    } finally {
      setPending(null);
    }
  }

  // Only clear on screen what the server really deleted.
  async function clearChat() {
    try {
      await apiCall('DELETE', `/api/agent/chat?fingerprint=${encodeURIComponent(fingerprint)}`);
      setMessages([]);
      setError('');
    } catch {
      setError("Couldn't clear the chat. Try again.");
    }
  }

  async function forgetMemory() {
    try {
      await apiCall('DELETE', '/api/agent/chat?memory=1');
      setMemory([]);
    } catch {
      setError("Couldn't forget your taste memory. Try again.");
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const mood: MascotMood = pending ? agentMood(pending.steps) : error ? 'sad' : input.focused ? 'curious' : 'idle';
  const empty = !loading && !messages.length && !pending;

  return (
    <section
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-white"
      style={{ boxShadow: '0 24px 60px rgba(28,26,31,.22)', animation: 'sheetIn .5s cubic-bezier(.2,1.2,.4,1) backwards' }}
      aria-label="Chat with YumFindAI about these places"
    >
      <header className="flex flex-none items-center gap-2.5 border-b border-line px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Mascot mood={mood} size={44} steam={false} shadow={false} follow lookAt={input.point} className="flex-none" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-display text-lg font-semibold leading-tight">Ask YumFindAI</p>
          <p className="m-0 truncate text-xs font-medium text-muted">
            About these {placeCount} places · chat saved{store === 'redis' ? ' in Redis' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void clearChat()}
          disabled={!messages.length || Boolean(pending)}
          aria-label="Clear this chat"
          title="Clear chat"
          className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full border-none bg-transparent text-muted hover:bg-mist hover:text-tomato disabled:cursor-default disabled:opacity-40"
        >
          <Trash2 size={16} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full border-none bg-mist text-ink hover:text-tomato"
        >
          <X size={17} strokeWidth={2.5} />
        </button>
      </header>

      {memory.length ? (
        <div className="flex flex-none items-center gap-2 border-b border-line bg-mist px-4 py-2 text-xs font-semibold text-ink-2">
          <span className="flex-none text-faint">Remembers</span>
          <span className="min-w-0 flex-1 truncate" title={memory.join(' · ')}>
            {memory.join(' · ')}
          </span>
          <button type="button" onClick={() => void forgetMemory()} className="flex-none cursor-pointer border-none bg-transparent px-1 py-1 text-xs font-bold text-tomato hover:underline">
            Forget
          </button>
        </div>
      ) : null}

      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4" aria-live="polite">
        {loading ? <p className="m-0 text-center text-sm text-faint">Loading your chat...</p> : null}
        {empty ? (
          <div className="flex items-start gap-2.5" style={{ animation: 'fadeUp .3s ease backwards' }}>
            <LogoMark size={26} className="mt-1 flex-none" />
            <div className="min-w-0">
              <div className="rounded-2xl rounded-tl-md bg-mist px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                Ask me anything about these places: spice, parking, families, distance. I answer from their newest reviews and check the web or directions when I need to.
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STARTERS.map((starter) => (
                  <button key={starter} type="button" className="pill-link text-xs" onClick={() => void send(starter)}>
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <UserBubble key={message.id} text={message.text} />
          ) : (
            <AssistantBubble key={message.id} message={message} onShowPlace={onShowPlace} />
          ),
        )}

        {pending ? (
          <>
            <UserBubble text={pending.question} />
            <div className="flex items-start gap-2.5" style={{ animation: 'fadeUp .3s ease backwards' }}>
              <LogoMark size={26} className="mt-1 flex-none" />
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-mist px-3.5 py-2.5">
                <AgentTrace steps={pending.steps} compact waiting="Thinking it over" />
              </div>
            </div>
          </>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2.5">
            <LogoMark size={26} className="mt-1 flex-none" />
            <div className="rounded-2xl rounded-tl-md bg-[#ffeceb] px-3.5 py-2.5 text-sm font-medium text-[#c4222d]">{error}</div>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex flex-none items-center gap-2 border-t border-line p-2.5 sm:p-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about spice, parking, families..."
          aria-label="Message YumFindAI"
          maxLength={240}
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-line-2 bg-mist px-3.5 text-sm font-medium text-ink outline-none focus:border-tomato focus:bg-white"
          {...input.bind}
        />
        <button
          type="submit"
          disabled={!draft.trim() || Boolean(pending)}
          aria-label="Send"
          className="btn-primary h-11 w-11 flex-none rounded-xl p-0 shadow-none"
        >
          <ArrowUp size={18} strokeWidth={2.75} />
        </button>
      </form>
    </section>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" style={{ animation: 'fadeUp .3s ease backwards' }}>
      <div className="max-w-[86%] break-words rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm font-medium leading-relaxed text-white sm:max-w-[82%]" style={{ background: 'var(--grad)' }}>
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ message, onShowPlace }: { message: ChatMessage; onShowPlace: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const steps = message.steps ?? [];
  return (
    <div className="flex items-start gap-2.5" style={{ animation: 'fadeUp .3s ease backwards' }}>
      <LogoMark size={26} className="mt-1 flex-none" />
      <div className="min-w-0 max-w-[86%]">
        <div className="break-words rounded-2xl rounded-tl-md bg-mist px-3.5 py-2.5 text-sm leading-relaxed text-ink">{message.text}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {message.placeId && message.placeName ? (
            <button
              type="button"
              onClick={() => onShowPlace(message.placeId as string)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border-[1.5px] border-line-2 bg-white px-2.5 py-1 text-xs font-bold text-ink hover:border-tomato hover:text-tomato"
            >
              <MapPin size={12} strokeWidth={2.75} />
              Show {message.placeName}
            </button>
          ) : null}
          {message.cached ? <span className="text-[11px] font-semibold text-faint">answered from memory</span> : null}
          {steps.length ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="cursor-pointer border-none bg-transparent px-0 py-1 text-[11px] font-bold text-tomato hover:underline"
            >
              {open ? 'Hide steps' : `How I checked · ${steps.length} step${steps.length === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </div>
        {open && steps.length ? (
          <div className="mt-1.5 rounded-xl bg-mist px-3 py-2" style={{ animation: 'fadeUp .25s ease backwards' }}>
            <AgentTrace steps={asSteps(steps)} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
