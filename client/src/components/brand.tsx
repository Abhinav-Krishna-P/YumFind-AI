import { LogoMark } from '@/components/mascot/Mascot';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

export const foodImg = (id: string) => `https://images.unsplash.com/photo-${id}?w=700&h=700&q=70&auto=format&fit=crop`;

export const CATEGORIES = [
  ['Biryani', '1563379091339-03b21ab4a4f8'],
  ['Pizza', '1574071318508-1cdbab80d002'],
  ['Dosa', '1668236543090-82eba5ee5976'],
  ['Burger', '1571091718767-18b5b1457add'],
  ['Dessert', '1563805042-7684c019e1cb'],
  ['Pasta', '1621996346565-e3dbc646d9a9'],
  ['Idly', '1589301760014-d929f3979dbc'],
  ['Samosa', '1601050690597-df0568f70950'],
].map(([label, id]) => ({ label, img: foodImg(id) }));

/** The YumFindAI lockup: the mascot's pin as the mark, then the wordmark. */
export function Logo({ size = 38, text = 23, to = '/' }: { size?: number; text?: number; to?: string }) {
  return (
    <Link to={to} aria-label="YumFindAI home" className="flex flex-none items-center gap-2 text-ink no-underline hover:text-ink">
      <LogoMark size={size} />
      <span className="font-display font-bold tracking-[-.01em]" style={{ fontSize: text }} aria-hidden="true">
        YumFind<span className="text-tomato">AI</span>
      </span>
    </Link>
  );
}

/** Sets the tab title, always ending in the product name. */
export function useTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} · YumFindAI` : 'YumFindAI · Food matched to your taste';
  }, [page]);
}

/** Image on a warm gradient; hides itself if the URL fails so the gradient shows through. */
export function Photo({
  src,
  className = '',
  imgClassName = '',
  style,
}: {
  src: string | null | undefined;
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`photo ${className}`} style={style}>
      {src && !failed ? (
        <img className={imgClassName} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : null}
    </div>
  );
}

export function LiveDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full" style={{ background: color }} />
      <span className="absolute inset-0 rounded-full" style={{ background: color, animation: 'pulse 1.6s ease-out infinite' }} />
    </span>
  );
}
