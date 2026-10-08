import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type SyntheticEvent } from 'react';
import { FACE, LogoMarkArt, MascotArt, VIEW, type MascotMood } from './art';
import './mascot.css';

export type { MascotMood };

type Point = { x: number; y: number };

function useUid() {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}

/** The YumFindAI logo mark. Below 24px it switches to bolder features so it still reads as a face. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  const uid = useUid();
  return <LogoMarkArt uid={uid} size={size} small={size < 24} className={className} />;
}

/**
 * The live mascot. Pass a `mood` for what the app is doing; it also reacts on its own:
 * blinks, follows the pointer (`follow`) or a point such as a text caret (`lookAt`),
 * cheers up on hover and hops when tapped.
 */
export function Mascot({
  mood = 'idle',
  size = 160,
  follow = false,
  lookAt = null,
  interactive = true,
  steam = true,
  outline = false,
  shadow = true,
  greet = false,
  className = '',
  style,
  title = 'YumFindAI',
}: {
  mood?: MascotMood;
  /** Wave hello for the first moments after mounting, then settle into `mood`. */
  greet?: boolean;
  size?: number | string;
  follow?: boolean;
  lookAt?: Point | null;
  interactive?: boolean;
  steam?: boolean;
  outline?: boolean;
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const uid = useUid();
  const svg = useRef<SVGSVGElement>(null);
  const [gaze, setGaze] = useState<Point>({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [hover, setHover] = useState(false);
  const [hop, setHop] = useState(0);
  const [greeting, setGreeting] = useState(greet);
  const targetX = lookAt?.x;
  const targetY = lookAt?.y;

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const aim = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      const box = Math.min(rect.width / VIEW.w, rect.height / VIEW.h);
      const cx = rect.left + rect.width / 2 + (FACE.x - VIEW.w / 2) * box;
      const cy = rect.top + rect.height / 2 + (FACE.y - VIEW.h / 2) * box;
      const vx = x - cx;
      const vy = y - cy;
      const distance = Math.hypot(vx, vy) || 1;
      const reach = Math.min(1, distance / 160);
      setGaze({ x: (vx / distance) * reach, y: (vy / distance) * reach });
    };
    if (targetX != null && targetY != null) {
      aim(targetX, targetY);
      return;
    }
    setGaze({ x: 0, y: 0 });
    if (!follow || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const onMove = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        aim(px, py);
      });
    };
    const onLeave = () => setGaze({ x: 0, y: 0 });
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [follow, targetX, targetY]);

  useEffect(() => {
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const blinkOnce = (then?: () => void) => {
      setBlink(true);
      later(() => {
        setBlink(false);
        then?.();
      }, 120);
    };
    const schedule = () =>
      later(() => blinkOnce(() => (Math.random() < 0.25 ? later(() => blinkOnce(schedule), 140) : schedule())), 2200 + Math.random() * 3400);
    schedule();
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    if (!greet) return;
    const id = window.setTimeout(() => setGreeting(false), 2600);
    return () => window.clearTimeout(id);
  }, [greet]);

  useEffect(() => {
    if (!hop) return;
    const id = window.setTimeout(() => setHop(0), 800);
    return () => window.clearTimeout(id);
  }, [hop]);

  const cheerful = hover && (mood === 'idle' || mood === 'curious' || mood === 'wave');
  const shown: MascotMood = hop ? 'found' : cheerful ? 'happy' : greeting && mood === 'idle' ? 'wave' : mood;

  return (
    <MascotArt
      svgRef={svg}
      uid={uid}
      mood={shown}
      gaze={gaze}
      blink={blink}
      hop={hop}
      steam={steam}
      outline={outline}
      shadow={shadow}
      size={size}
      title={title}
      style={style}
      className={`${interactive ? 'is-interactive ' : ''}${className}`.trim()}
      onPointerEnter={interactive ? () => setHover(true) : undefined}
      onPointerLeave={interactive ? () => setHover(false) : undefined}
      onClick={interactive ? () => setHop(Date.now()) : undefined}
    />
  );
}

let measure: CanvasRenderingContext2D | null = null;

/** Screen position of the text caret in an input, so the mascot can watch you type. */
export function caretPoint(input: HTMLInputElement): Point {
  const rect = input.getBoundingClientRect();
  const css = getComputedStyle(input);
  measure ||= document.createElement('canvas').getContext('2d');
  let width = 0;
  if (measure) {
    measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const text = input.type === 'password' ? '•'.repeat(input.value.length) : input.value.slice(0, input.selectionStart ?? input.value.length);
    width = measure.measureText(text).width;
  }
  const pad = parseFloat(css.paddingLeft) || 0;
  return { x: rect.left + pad + Math.max(0, Math.min(width - input.scrollLeft, rect.width - pad * 2)), y: rect.top + rect.height / 2 };
}

/** Spread `bind` onto an input; `point` is where the caret is while it has focus. */
export function useInputGaze() {
  const [focused, setFocused] = useState<HTMLInputElement | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const track = (event: SyntheticEvent<HTMLInputElement>) => setPoint(caretPoint(event.currentTarget));
  return {
    focused,
    point,
    bind: {
      onFocus: (event: FocusEvent<HTMLInputElement>) => {
        setFocused(event.currentTarget);
        track(event);
      },
      onBlur: () => {
        setFocused(null);
        setPoint(null);
      },
      onInput: track,
      onKeyUp: track,
      onClick: track,
    },
  };
}
