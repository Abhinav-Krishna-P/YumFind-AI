import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre looks for its tile worker next to its own file, but Vite bundles that file elsewhere
// (into .vite/deps in dev, a hashed chunk in a build), so the worker 404s and no map tiles draw.
// Point it at the worker file Vite actually serves.
maplibregl.setWorkerUrl(workerUrl);

export type RoutePoint = { lat: number; lng: number };

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rank: number;
  rating: number | null;
  thumbnail: string | null;
  selected?: boolean;
};

type Props = {
  user: { lat: number; lng: number } | null;
  places: MapPoint[];
  route: RoutePoint[];
  dropMode: boolean;
  onDrop: (lat: number, lng: number) => void;
  onSelect: (id: string) => void;
};

const GRAD = 'linear-gradient(135deg,#ff7a3d,#ff3d54)';

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function userPin() {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:24px;height:24px';
  el.innerHTML =
    '<span style="position:absolute;inset:0;border-radius:50%;background:#3d7bff;opacity:.45;animation:pulse 2s ease-out infinite"></span>' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:#3d7bff;opacity:.45;animation:pulse 2s ease-out 1s infinite"></span>' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:#3d7bff;border:4px solid #fff;box-shadow:0 4px 12px rgba(30,60,160,.35);animation:pinDrop .6s cubic-bezier(.2,1.4,.4,1) backwards"></span>';
  return el;
}

function placePin(place: MapPoint, index: number, animate: boolean) {
  const sel = Boolean(place.selected);
  const root = document.createElement('button');
  root.type = 'button';
  root.className = sel ? 'place-pin selected' : 'place-pin';
  root.setAttribute('aria-label', place.name);
  root.style.zIndex = sel ? '5' : '1';
  root.onmouseenter = () => (root.style.zIndex = '10');
  root.onmouseleave = () => (root.style.zIndex = sel ? '5' : '1');

  const photo = place.thumbnail
    ? `<img src="${escapeHtml(place.thumbnail)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.visibility='hidden'">`
    : '';
  const rating = place.rating != null ? ` <span style="color:#1fa45a">★ ${place.rating.toFixed(1)}</span>` : '';
  root.innerHTML =
    `<div class="place-pin-inner" style="${animate ? `animation:pinDrop .65s cubic-bezier(.2,1.4,.4,1) ${index * 80}ms backwards` : ''}">` +
    `<div style="width:54px;height:54px;border-radius:50%;padding:3px;background:${sel ? GRAD : '#fff'};box-shadow:0 8px 22px rgba(28,26,31,.3)">` +
    `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:${GRAD}">${photo}</div></div>` +
    `<div style="width:0;height:0;margin-top:-2px;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid ${sel ? '#ff3d54' : '#fff'}"></div>` +
    `<span style="position:absolute;right:-5px;top:-5px;min-width:22px;height:22px;padding:0 5px;border-radius:999px;background:${GRAD};color:#fff;border:2px solid #fff;font:700 11px 'Plus Jakarta Sans',system-ui;display:grid;place-items:center">${place.rank}</span>` +
    `<span class="place-pin-label">${escapeHtml(place.name)}${rating}</span>` +
    '</div>';
  return root;
}

/**
 * Map padding that keeps pins clear of the floating header and the bottom sheet.
 * `sheet` is the share of the map height the sheet covers; it is capped so a short phone
 * screen always keeps some map to show the pins in.
 */
function sheetPadding(map: maplibregl.Map, sheet: number) {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const phone = width < 640;
  // The floating header plus a pin's height (pins hang above their point), so no pin hides under it.
  const top = phone ? 140 : 150;
  const side = phone ? 28 : 60;
  const bottom = Math.max(40, Math.min(Math.round(height * sheet), height - top - 140));
  return { top, bottom, left: side, right: side };
}

function fitPlaces(map: maplibregl.Map, user: RoutePoint | null, places: MapPoint[]) {
  if (!user || !places.length) return;
  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([user.lng, user.lat]);
  for (const place of places) bounds.extend([place.lng, place.lat]);
  const tall = map.getContainer().clientHeight;
  map.fitBounds(bounds, { padding: sheetPadding(map, tall < 760 ? 0.5 : Math.min(0.55, 440 / tall)), duration: 1100, maxZoom: 15 });
}

export function MapCanvas({ user, places, route, dropMode, onDrop, onSelect }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Set once the style has loaded; isStyleLoaded() also turns false while tiles stream in, which used to skip routes.
  const ready = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pinIds = useRef('');
  const routeRaf = useRef(0);
  const hadRoute = useRef(false);
  const latest = useRef({ user, places });
  latest.current = { user, places };
  const dropRef = useRef(dropMode);
  const onDropRef = useRef(onDrop);
  const onSelectRef = useRef(onSelect);
  dropRef.current = dropMode;
  onDropRef.current = onDrop;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: holder.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [77.5946, 12.9716],
      zoom: 11,
      attributionControl: { compact: true },
      // 3x phone screens would draw 9x the pixels of a desktop; 2x looks the same and is far cheaper.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      // The map stays north-up and flat: two-finger gestures only zoom, so pinching never tilts or spins it.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 150,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const resize = () => map.resize();
    map.on('load', () => {
      ready.current = true;
      resize();
    });
    // Follows every size change of the map box: rotation, the browser bar, the on-screen keyboard.
    const observer = new ResizeObserver(() => resize());
    observer.observe(holder.current);
    map.on('click', (event) => {
      if (!dropRef.current) return;
      onDropRef.current(event.lngLat.lat, event.lngLat.lng);
    });
    map.on('error', (event) => {
      const message = event.error?.message ?? '';
      if (!/style/i.test(message) || map.getStyle()?.layers?.some((layer) => layer.id === 'carto')) return;
      map.setStyle({
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap © CARTO',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      });
    });
    mapRef.current = map;
    requestAnimationFrame(resize);
    return () => {
      cancelAnimationFrame(routeRaf.current);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !user) return;
    const fly = () => {
      map.resize();
      map.flyTo({
        center: [user.lng, user.lat],
        zoom: 14.6,
        duration: 1400,
        padding: { top: 60, bottom: Math.min(260, Math.round(map.getContainer().clientHeight * 0.4)), left: 0, right: 0 },
        essential: true,
      });
    };
    if (ready.current) fly();
    else map.once('load', fly);
  }, [user]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    if (user) markers.current.push(new maplibregl.Marker({ element: userPin() }).setLngLat([user.lng, user.lat]).addTo(map));

    const idKey = places.map((place) => place.id).join(',');
    const fresh = idKey !== pinIds.current;
    pinIds.current = idKey;
    places.forEach((place, index) => {
      const pin = placePin(place, index, fresh);
      pin.onclick = (event) => {
        event.stopPropagation();
        onSelectRef.current(place.id);
      };
      markers.current.push(new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([place.lng, place.lat]).addTo(map));
    });

    if (fresh) fitPlaces(map, user, places);
  }, [places, user]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const set = (coords: number[][]) => {
      const data =
        coords.length > 1
          ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } }
          : { type: 'FeatureCollection' as const, features: [] };
      const existing = map.getSource('route') as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      map.addSource('route', { type: 'geojson', data });
      const layout = { 'line-cap': 'round' as const, 'line-join': 'round' as const };
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout, paint: { 'line-color': '#ffffff', 'line-width': 11 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout, paint: { 'line-color': '#ff4b2b', 'line-width': 6 } });
    };

    const apply = () => {
      cancelAnimationFrame(routeRaf.current);
      if (route.length < 2) {
        set([]);
        if (hadRoute.current) fitPlaces(map, latest.current.user, latest.current.places);
        hadRoute.current = false;
        return;
      }
      hadRoute.current = true;
      // Draw the route progressively so it "grows" from the user to the place.
      const pts = route.map((point) => [point.lng, point.lat]);
      const seg: number[] = [];
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        seg.push(d);
        total += d;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900);
        let want = total * (1 - Math.pow(1 - k, 3));
        const out = [pts[0]];
        for (let i = 0; i < seg.length; i += 1) {
          if (want >= seg[i]) {
            out.push(pts[i + 1]);
            want -= seg[i];
          } else {
            const f = seg[i] ? want / seg[i] : 0;
            out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
            break;
          }
        }
        set(out);
        if (k < 1) routeRaf.current = requestAnimationFrame(step);
      };
      routeRaf.current = requestAnimationFrame(step);

      const bounds = new maplibregl.LngLatBounds();
      for (const point of pts) bounds.extend(point as [number, number]);
      map.fitBounds(bounds, {
        padding: sheetPadding(map, 0.64),
        duration: 900,
        maxZoom: 15.5,
      });
    };
    if (ready.current) apply();
    else map.once('load', apply);
  }, [route]);

  return <div ref={holder} className={`map-shell absolute inset-0 ${dropMode ? 'cursor-crosshair' : ''}`} />;
}
