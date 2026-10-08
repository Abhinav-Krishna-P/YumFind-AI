/*
 * The YumFindAI character: a map pin (find) whose face is a steamed bun (yum).
 * Pure SVG with no hooks, so the same drawing renders live in the app and into the static brand files.
 * Every motion is a translate or a scale. Nothing rotates.
 */
import type { CSSProperties, MouseEventHandler, PointerEventHandler, Ref } from 'react';

export type MascotMood =
  | 'idle'
  | 'wave'
  | 'happy'
  | 'curious'
  | 'shy'
  | 'thinking'
  | 'searching'
  | 'reading'
  | 'found'
  | 'sad'
  | 'listening';

export const VIEW = { w: 200, h: 260 } as const;
/** Centre of the face in viewBox units, used to aim the eyes. */
export const FACE = { x: 100, y: 114 } as const;

const INK = '#2b1b22';
const MOUTH = '#4a1f2a';
const TONGUE = '#ff6b81';
const BLUSH = '#ff8a9c';
const STEAM = '#ff9a72';

/** The pin: a 76-unit head centred at (100,112) tapering to a rounded tip at y≈229. */
export const BODY_PATH =
  'M92.5 222C84 211 57.66 180.25 41.19 160.13A76 76 0 1 1 158.81 160.13C142.34 180.25 116 211 107.5 222Q100 236 92.5 222Z';

type Eyes = 'open' | 'happy' | 'wide';
type Mouth = 'smile' | 'grin' | 'o' | 'small' | 'hmm' | 'frown';
type Brows = 'up' | 'sad' | 'think' | null;
type Arms = 'rest' | 'low' | 'wave' | 'cover' | 'lens' | 'card' | 'cheer' | 'chin' | 'ear';
type Motion = 'breathe' | 'bounce' | 'shake';
type Extra = 'lens' | 'card' | 'dots' | 'sparkles' | 'sweat' | 'waves';

type Look = {
  eyes: Eyes;
  mouth: Mouth;
  brows: Brows;
  arms: Arms;
  blush: number;
  motion: Motion;
  /** Fixed gaze for moods that look somewhere specific; otherwise the caller's gaze is used. */
  gaze?: { x: number; y: number };
  scan?: boolean;
  extra?: Extra;
};

const LOOKS: Record<MascotMood, Look> = {
  idle: { eyes: 'open', mouth: 'smile', brows: null, arms: 'rest', blush: 0.5, motion: 'breathe' },
  wave: { eyes: 'open', mouth: 'grin', brows: null, arms: 'wave', blush: 0.6, motion: 'breathe' },
  happy: { eyes: 'happy', mouth: 'grin', brows: null, arms: 'rest', blush: 0.75, motion: 'bounce' },
  curious: { eyes: 'open', mouth: 'o', brows: 'up', arms: 'rest', blush: 0.5, motion: 'breathe' },
  shy: { eyes: 'open', mouth: 'small', brows: null, arms: 'cover', blush: 0.95, motion: 'breathe' },
  thinking: {
    eyes: 'open',
    mouth: 'hmm',
    brows: 'think',
    arms: 'rest',
    blush: 0.45,
    motion: 'breathe',
    gaze: { x: 0.55, y: -0.9 },
    extra: 'dots',
  },
  searching: {
    eyes: 'open',
    mouth: 'o',
    brows: 'up',
    arms: 'lens',
    blush: 0.5,
    motion: 'breathe',
    gaze: { x: 0, y: 0 },
    extra: 'lens',
  },
  reading: {
    eyes: 'open',
    mouth: 'small',
    brows: null,
    arms: 'card',
    blush: 0.5,
    motion: 'breathe',
    gaze: { x: 0, y: 0.85 },
    scan: true,
    extra: 'card',
  },
  found: { eyes: 'happy', mouth: 'grin', brows: null, arms: 'cheer', blush: 0.8, motion: 'bounce', extra: 'sparkles' },
  sad: {
    eyes: 'open',
    mouth: 'frown',
    brows: 'sad',
    arms: 'low',
    blush: 0.3,
    motion: 'shake',
    gaze: { x: 0, y: 0.6 },
    extra: 'sweat',
  },
  listening: { eyes: 'wide', mouth: 'o', brows: 'up', arms: 'ear', blush: 0.55, motion: 'breathe', extra: 'waves' },
};

type Pose = { x: number; y: number; s?: number };
type Home = { x: number; y: number };

const ARM_HOME: { l: Home; r: Home } = { l: { x: 40, y: 172 }, r: { x: 160, y: 172 } };
const ARM_POSES: Record<Arms, [Pose, Pose]> = {
  rest: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  low: [{ x: 3, y: 5 }, { x: -3, y: 5 }],
  wave: [{ x: 0, y: 0 }, { x: 22, y: -64 }],
  cover: [{ x: 38, y: -56, s: 1.6 }, { x: -38, y: -56, s: 1.6 }],
  lens: [{ x: 0, y: 0 }, { x: -8, y: -26 }],
  card: [{ x: 28, y: 16 }, { x: -28, y: 16 }],
  cheer: [{ x: -20, y: -88 }, { x: 20, y: -88 }],
  chin: [{ x: 0, y: 0 }, { x: -38, y: -22 }],
  ear: [{ x: 0, y: 0 }, { x: 20, y: -54 }],
};

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

/** Static renders use SVG transform attributes; live renders use CSS so poses can transition. */
function placed(still: boolean, x: number, y: number, s = 1, home?: Home) {
  if (still) {
    const scale = s === 1 || !home ? '' : ` translate(${home.x} ${home.y}) scale(${s}) translate(${-home.x} ${-home.y})`;
    return { transform: `translate(${x} ${y})${scale}` };
  }
  return { style: { transform: `translate(${x}px, ${y}px) scale(${s})` } as CSSProperties };
}

function star(cx: number, cy: number, r: number) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 ? r * 0.45 : r;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

function sparkle(x: number, y: number, s: number) {
  return `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;
}

function Gradients({ id }: { id: (name: string) => string }) {
  return (
    <defs>
      <radialGradient id={id('body')} cx="0.36" cy="0.3" r="0.78">
        <stop offset="0" stopColor="#ffb06c" />
        <stop offset="0.42" stopColor="#ff7a3d" />
        <stop offset="0.8" stopColor="#ff4d4f" />
        <stop offset="1" stopColor="#e2334e" />
      </radialGradient>
      <radialGradient id={id('face')} cx="0.42" cy="0.34" r="0.75">
        <stop offset="0" stopColor="#fffdf9" />
        <stop offset="0.65" stopColor="#fff2e4" />
        <stop offset="1" stopColor="#ffdcc4" />
      </radialGradient>
      <radialGradient id={id('arm')} cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#ff9a5a" />
        <stop offset="1" stopColor="#ef3f4f" />
      </radialGradient>
      <radialGradient id={id('shine')}>
        <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={id('shadow')}>
        <stop offset="0" stopColor={INK} stopOpacity="0.26" />
        <stop offset="1" stopColor={INK} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

function Eye({ cx, cy, kind, magnify = false }: { cx: number; cy: number; kind: Eyes; magnify?: boolean }) {
  if (kind === 'happy') {
    return (
      <path d={`M${cx - 9} ${cy + 3}Q${cx} ${cy - 10} ${cx + 9} ${cy + 3}`} fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
    );
  }
  const rx = kind === 'wide' ? 9.6 : 8.6;
  const ry = kind === 'wide' ? 12.6 : 11.6;
  const eye = (
    <g className="m-eye">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={INK} />
      <circle cx={cx + 3.4} cy={cy - 5.2} r={3.5} fill="#fff" />
      <circle cx={cx - 2.6} cy={cy + 5.2} r={1.7} fill="#fff" opacity={0.85} />
    </g>
  );
  return magnify ? <g transform={`translate(${cx} ${cy}) scale(1.32) translate(${-cx} ${-cy})`}>{eye}</g> : eye;
}

function MouthShape({ kind, clip }: { kind: Mouth; clip: string }) {
  const line = { fill: 'none', stroke: MOUTH, strokeWidth: 3.6, strokeLinecap: 'round' as const };
  if (kind === 'smile' || kind === 'grin') {
    const d = kind === 'smile' ? 'M91 132Q100 150 109 132Q100 135.5 91 132Z' : 'M86 130Q100 158 114 130Q100 135 86 130Z';
    return (
      <g>
        <clipPath id={clip}>
          <path d={d} />
        </clipPath>
        <path d={d} fill={MOUTH} />
        <ellipse cx={100} cy={kind === 'smile' ? 142 : 146} rx={kind === 'smile' ? 5.5 : 8} ry={kind === 'smile' ? 4 : 5.5} fill={TONGUE} clipPath={`url(#${clip})`} />
      </g>
    );
  }
  if (kind === 'o') return <ellipse cx={100} cy={137} rx={5.5} ry={6.6} fill={MOUTH} />;
  if (kind === 'small') return <path d="M94.5 134Q100 140.5 105.5 134" {...line} />;
  if (kind === 'hmm') return <path d="M93 137.5Q98.5 134 107 136" {...line} />;
  return <path d="M92 141Q100 132.5 108 141" {...line} />;
}

const BROWS: Record<Exclude<Brows, null>, [string, string]> = {
  up: ['M71 98Q79.5 91.5 88 95.5', 'M112 95.5Q120.5 91.5 129 98'],
  sad: ['M71 98.5Q80 97 88 91.5', 'M112 91.5Q120 97 129 98.5'],
  think: ['M71 96Q79.5 93 88 95', 'M112 94Q121 87.5 129 92.5'],
};

function Arm({
  home,
  pose,
  still,
  loop,
  fill,
  outline,
  paw = false,
}: {
  home: Home;
  pose: Pose;
  still: boolean;
  loop?: string;
  fill: string;
  outline: boolean;
  paw?: boolean;
}) {
  return (
    <g className="m-arm" {...placed(still, pose.x, pose.y, pose.s, home)}>
      <g className={loop}>
        <ellipse
          cx={home.x}
          cy={home.y}
          rx={12}
          ry={10.5}
          fill={fill}
          stroke={outline ? '#fff' : '#a3283a'}
          strokeOpacity={outline ? 1 : 0.2}
          strokeWidth={outline ? 5 : 1.5}
          paintOrder="stroke"
        />
        <ellipse cx={home.x - 3} cy={home.y - 3.6} rx={4.2} ry={2.6} fill="#fff" opacity={0.35} />
        {paw ? (
          <g fill="none" stroke="#b42a3c" strokeOpacity={0.5} strokeWidth={1.5} strokeLinecap="round">
            <path d={`M${home.x - 4} ${home.y - 9.8}v4.2`} />
            <path d={`M${home.x + 1.5} ${home.y - 10.4}v4.6`} />
            <path d={`M${home.x + 6.6} ${home.y - 8.8}v3.8`} />
          </g>
        ) : null}
      </g>
    </g>
  );
}

function ReviewCard() {
  return (
    <g>
      <rect x={68} y={150} width={64} height={46} rx={9} fill="#fff" stroke="#f1d6c8" strokeWidth={2} />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={star(80 + i * 10, 161, 4.4)} fill={i < 4 ? '#ffc531' : '#ecdfe4'} />
      ))}
      <rect x={76} y={171} width={48} height={4.6} rx={2.3} fill="#eadfe5" />
      <rect x={76} y={180} width={38} height={4.6} rx={2.3} fill="#eadfe5" />
      <rect x={76} y={189} width={43} height={4.6} rx={2.3} fill="#eadfe5" />
    </g>
  );
}

function Lens() {
  return (
    <g className="m-bob">
      <line x1={132} y1={127} x2={147} y2={144} stroke={INK} strokeWidth={7} strokeLinecap="round" />
      <circle cx={120} cy={115} r={17.5} fill="#fff" fillOpacity={0.22} stroke={INK} strokeWidth={5} />
      <path d="M108.5 109.5Q111 103.5 117.5 101.6" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.95} />
    </g>
  );
}

export type MascotArtProps = {
  uid: string;
  mood?: MascotMood;
  /** -1..1 in each axis; where the eyes point. */
  gaze?: { x: number; y: number };
  blink?: boolean;
  /** Non-zero restarts the hop animation. */
  hop?: number;
  steam?: boolean;
  /** White sticker outline, for coloured backgrounds. */
  outline?: boolean;
  shadow?: boolean;
  /** Static output (brand files): SVG transform attributes instead of CSS. */
  still?: boolean;
  /** Height in px, or a CSS length that fills a box (e.g. "100%"). */
  size?: number | string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  svgRef?: Ref<SVGSVGElement>;
  onPointerEnter?: PointerEventHandler<SVGSVGElement>;
  onPointerLeave?: PointerEventHandler<SVGSVGElement>;
  onClick?: MouseEventHandler<SVGSVGElement>;
};

export function MascotArt({
  uid,
  mood = 'idle',
  gaze = { x: 0, y: 0 },
  blink = false,
  hop = 0,
  steam = true,
  outline = false,
  shadow = true,
  still = false,
  size = 160,
  title = 'YumFindAI',
  className = '',
  style,
  svgRef,
  ...handlers
}: MascotArtProps) {
  const look = LOOKS[mood];
  const aim = look.gaze ?? gaze;
  const gx = clamp(aim.x) * 6;
  const gy = clamp(aim.y) * 4.6;
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const [poseL, poseR] = ARM_POSES[look.arms];
  const motion = hop ? 'm-hop' : `m-${look.motion}`;
  const shadowMotion = hop ? 'm-shadow-hop' : look.motion === 'bounce' ? 'm-shadow-bounce' : 'm-shadow-breathe';
  const box =
    typeof size === 'number'
      ? { height: size, width: Number(((size * VIEW.w) / VIEW.h).toFixed(2)), style }
      : { style: { height: size, width: size, ...style } };

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label={title}
      className={`yf-mascot${blink ? ' is-blink' : ''}${className ? ` ${className}` : ''}`}
      {...box}
      {...handlers}
    >
      <Gradients id={id} />
      {shadow ? <ellipse key={`s${hop}`} className={`m-shadow ${shadowMotion}`} cx={100} cy={242} rx={42} ry={7} fill={url('shadow')} /> : null}
      <g key={`c${hop}`} className={`m-char ${motion}`}>
        {steam ? (
          <g fill="none" stroke={STEAM} strokeWidth={4.2} strokeLinecap="round">
            <path className="m-steam" opacity={0.75} d="M84 31Q78 24 84 17Q90 10 84 3" />
            <path className="m-steam m-s2" opacity={0.75} d="M100 28Q94 21 100 14Q106 7 100 1" />
            <path className="m-steam m-s3" opacity={0.75} d="M116 31Q110 24 116 17Q122 10 116 3" />
          </g>
        ) : null}
        <path
          d={BODY_PATH}
          fill={url('body')}
          {...(outline ? { stroke: '#fff', strokeWidth: 10, strokeLinejoin: 'round' as const, paintOrder: 'stroke' } : {})}
        />
        <ellipse cx={86} cy={46} rx={15} ry={5.5} fill={url('shine')} opacity={0.8} />
        <ellipse cx={55} cy={68} rx={8} ry={5.5} fill={url('shine')} />
        <circle cx={FACE.x} cy={FACE.y} r={58} fill={url('face')} />
        <circle cx={FACE.x} cy={FACE.y} r={58} fill="none" stroke="#d6502a" strokeOpacity={0.16} strokeWidth={3} />
        <ellipse cx={66} cy={133} rx={9.5} ry={6} fill={BLUSH} opacity={look.blush} />
        <ellipse cx={134} cy={133} rx={9.5} ry={6} fill={BLUSH} opacity={look.blush} />
        <g className="m-gaze" {...placed(still, gx, gy)}>
          <g className={look.scan ? 'm-scan' : undefined}>
            <Eye cx={80} cy={115} kind={look.eyes} />
            <Eye cx={120} cy={115} kind={look.eyes} magnify={look.extra === 'lens'} />
          </g>
        </g>
        {look.brows ? (
          <g fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round" opacity={0.85}>
            <path d={BROWS[look.brows][0]} />
            <path d={BROWS[look.brows][1]} />
          </g>
        ) : null}
        <MouthShape kind={look.mouth} clip={id('mouth')} />
        {look.extra === 'card' ? <ReviewCard /> : null}
        {look.extra === 'lens' ? <Lens /> : null}
        <Arm home={ARM_HOME.l} pose={poseL} still={still} fill={url('arm')} outline={outline} paw={look.arms === 'cover'} />
        <Arm
          home={ARM_HOME.r}
          pose={poseR}
          still={still}
          loop={look.arms === 'wave' ? 'm-wave' : look.arms === 'lens' ? 'm-bob' : undefined}
          fill={url('arm')}
          outline={outline}
          paw={look.arms === 'cover'}
        />
        {look.extra === 'dots' ? (
          <g fill="#ffb48f">
            <circle className="m-dot" cx={162} cy={52} r={3.2} />
            <circle className="m-dot m-d2" cx={172} cy={38} r={4.6} />
            <circle className="m-dot m-d3" cx={185} cy={22} r={6.2} />
          </g>
        ) : null}
        {look.extra === 'sparkles' ? (
          <g fill="#ffc531">
            <path className="m-spark" d={sparkle(12, 132, 8)} />
            <path className="m-spark m-d2" d={sparkle(190, 134, 7)} />
            <path className="m-spark m-d3" d={sparkle(52, 24, 6)} />
            <path className="m-spark m-d2" d={sparkle(150, 22, 7.5)} />
            <path className="m-spark m-d3" d={sparkle(184, 178, 5)} />
          </g>
        ) : null}
        {look.extra === 'sweat' ? (
          <g className="m-sweat">
            <path d="M150 74Q156 84 150 88Q144 84 150 74Z" fill="#8fd3ff" />
            <ellipse cx={148.6} cy={83} rx={1.4} ry={2.2} fill="#fff" opacity={0.8} />
          </g>
        ) : null}
        {look.extra === 'waves' ? (
          <g fill="none" stroke="#ff4b2b" strokeWidth={3.2} strokeLinecap="round">
            <path className="m-ring" d="M184 76Q190 86 184 96" />
            <path className="m-ring m-d2" d="M191 68Q199 86 191 104" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

/** The logo mark: the same pin and face, no arms or steam. `small` thickens features for favicon sizes. */
export function LogoMarkArt({
  uid,
  size = 40,
  small = false,
  square = false,
  title = 'YumFindAI',
  className = '',
}: {
  uid: string;
  size?: number;
  small?: boolean;
  square?: boolean;
  title?: string;
  className?: string;
}) {
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const vb = square ? { x: -1, y: 32, w: 202, h: 202 } : { x: 20, y: 32, w: 160, h: 202 };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      height={size}
      width={Number(((size * vb.w) / vb.h).toFixed(2))}
      role="img"
      aria-label={title}
      className={className}
    >
      <Gradients id={id} />
      <path d={BODY_PATH} fill={url('body')} />
      {small ? null : <ellipse cx={86} cy={46} rx={15} ry={5.5} fill={url('shine')} opacity={0.8} />}
      <circle cx={FACE.x} cy={FACE.y} r={small ? 60 : 58} fill={url('face')} />
      {small ? (
        <>
          <ellipse cx={79} cy={113} rx={11.5} ry={15} fill={INK} />
          <ellipse cx={121} cy={113} rx={11.5} ry={15} fill={INK} />
          <path d="M86 140Q100 154 114 140" fill="none" stroke={MOUTH} strokeWidth={7.5} strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx={66} cy={133} rx={9.5} ry={6} fill={BLUSH} opacity={0.5} />
          <ellipse cx={134} cy={133} rx={9.5} ry={6} fill={BLUSH} opacity={0.5} />
          <Eye cx={80} cy={115} kind="open" />
          <Eye cx={120} cy={115} kind="open" />
          <MouthShape kind="smile" clip={id('mouth')} />
        </>
      )}
    </svg>
  );
}
