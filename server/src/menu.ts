import { env } from './env.js';
import { readMenuPhoto, type MenuItem } from './gemini.js';
import { kvGet, kvSet } from './kv.js';
import { HttpError } from './types.js';

/*
 * Menu & prices: restaurants post photos of their menu on Google Maps. This fetches the "Menu" photo
 * category (SerpApi engine=google_maps_photos) and has Gemini read the dishes and prices off them.
 * Results are cached per place for 14 days, so only the first person to open a menu pays for it.
 */

export type MenuPhoto = { thumb: string; image: string };
export type Menu = { photos: MenuPhoto[]; items: MenuItem[]; read: number; at: number };

// Google's Menu photo category; looked up from the place's category list if this ever stops matching.
const MENU_CATEGORY = 'CgIYIQ';
const MENU_TTL = 14 * 24 * 60 * 60;
const READ_PHOTOS = 6;

async function photos(dataId: string, categoryId?: string) {
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google_maps_photos',
    data_id: dataId,
    hl: 'en',
    api_key: env.serp,
    ...(categoryId ? { category_id: categoryId } : {}),
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = (await res.json()) as {
    error?: string;
    categories?: { title?: string; id?: string }[];
    photos?: { thumbnail?: string; image?: string }[];
  };
  if (body.error && !/hasn't returned any results/i.test(body.error)) throw new HttpError(503, body.error);
  return {
    categories: body.categories || [],
    photos: (body.photos || [])
      .filter((photo): photo is { thumbnail: string; image: string } => Boolean(photo.thumbnail && photo.image))
      .map((photo) => ({ thumb: photo.thumbnail, image: photo.image })),
  };
}

/** Google photo URLs carry their size; ask for something legible but small enough to send. */
function readable(image: string) {
  return image.replace(/=w\d+-h\d+(-k-no)?$/, '=w1400-h1400-k-no');
}

async function download(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  if (!mime.startsWith('image/')) return null;
  return { mime, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

export async function placeMenu(dataId: string): Promise<Menu & { cached: boolean }> {
  const key = `menu:${dataId}`;
  const known = await kvGet<Menu>(key);
  if (known) return { ...known, cached: true };
  if (dataId.startsWith('pid:')) throw new HttpError(404, 'No menu photos for this place');

  let found = await photos(dataId, MENU_CATEGORY);
  if (!found.photos.length) {
    const menuCategory = (await photos(dataId)).categories.find((category) => /menu/i.test(category.title || ''));
    if (menuCategory?.id && menuCategory.id !== MENU_CATEGORY) found = await photos(dataId, menuCategory.id);
  }
  const picked = found.photos.slice(0, READ_PHOTOS);
  if (!picked.length) {
    const empty: Menu = { photos: [], items: [], read: 0, at: Date.now() };
    await kvSet(key, empty, 3 * 24 * 60 * 60);
    return { ...empty, cached: false };
  }

  // Each photo is read by its own call, all at once, then merged.
  const read = await Promise.all(
    picked.map(async (photo, index) => {
      const image = await download(readable(photo.image)).catch(() => null);
      if (!image) return { index, items: null as MenuItem[] | null, ok: false };
      const items = await readMenuPhoto(image, index).catch((error) => {
        console.error('[menu]', error instanceof Error ? error.message : error);
        return null;
      });
      return { index, items, ok: items !== null };
    }),
  );
  const seen = new Set<string>();
  const items: MenuItem[] = [];
  for (const row of read) {
    for (const item of row.items ?? []) {
      const id = `${item.name.toLowerCase()}|${item.price ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }
  }
  const menuPhotos = read.filter((row) => row.items?.length).map((row) => row.index);
  // Menu photos first, so the strip opens on what was read.
  const order = [...new Set([...menuPhotos, ...picked.map((_, index) => index)])];
  const menu: Menu = {
    photos: [...order.map((index) => picked[index]), ...found.photos.slice(READ_PHOTOS)].slice(0, 12),
    items: items.slice(0, 200),
    read: read.filter((row) => row.ok).length,
    at: Date.now(),
  };
  const result = read.some((row) => row.ok);
  if (result) await kvSet(key, menu, MENU_TTL);
  return { ...menu, cached: false };
}

/** Menu lines for the chat, when a menu has already been read for this place. */
export async function menuLines(dataId: string, limit = 30) {
  const menu = await kvGet<Menu>(`menu:${dataId}`);
  return menu?.items.slice(0, limit).map((item) => `${item.name}${item.price != null ? ` ₹${item.price}` : ''}`) ?? [];
}
