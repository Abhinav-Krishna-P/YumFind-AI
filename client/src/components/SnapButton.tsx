import { api } from '@/lib/api';
import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';

export type SnapState = { status: 'idle' | 'working' | 'error' | 'done'; message?: string; dish?: string };

/** Shrinks a photo in the browser so only ~150 KB is uploaded. */
function shrink(file: File, max = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that photo."));
    };
    img.src = url;
  });
}

/**
 * "Snap a dish": pick or take a food photo; Google Lens (through the server) names the dish.
 * Reports progress through `onChange` so the page and mascot can react.
 */
export function SnapButton({ onChange, className = '', label = false }: { onChange: (state: SnapState) => void; className?: string; label?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onChange({ status: 'working' });
    try {
      const image = await shrink(file);
      const result = await api<{ dish: string; confidence: number }>('/api/dish/identify', { image });
      onChange({ status: 'done', dish: result.dish });
    } catch (error) {
      onChange({ status: 'error', message: error instanceof Error ? error.message : "Couldn't recognise that dish." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label="Snap a dish: search by photo"
        title="Snap a dish: search by photo"
        className={`inline-flex flex-none cursor-pointer items-center justify-center gap-1.5 rounded-xl border-none bg-white font-bold text-tomato hover:bg-blush disabled:cursor-default disabled:opacity-60 ${className}`}
        style={{ boxShadow: '0 2px 8px rgba(28,26,31,.08)' }}
      >
        <Camera size={19} strokeWidth={2.5} />
        {label ? <span className="text-sm">{busy ? 'Looking...' : 'Snap a dish'}</span> : null}
      </button>
    </>
  );
}
