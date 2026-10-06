import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

export type RoutePoint = { lat: number; lng: number };

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
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

export function MapCanvas({ user, places, route, dropMode, onDrop, onSelect }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
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
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const resize = () => map.resize();
    map.on('load', resize);
    window.addEventListener('resize', resize);
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
      window.removeEventListener('resize', resize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !user) return;
    const fly = () => {
      map.resize();
      map.flyTo({ center: [user.lng, user.lat], zoom: 14, duration: 900 });
    };
    if (map.isStyleLoaded()) fly();
    else map.once('load', fly);
  }, [user]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    if (user) {
      const person = document.createElement('div');
      person.className = 'you-pin';
      person.title = 'You';
      person.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="7" r="3" fill="currentColor"/><path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      markers.current.push(new maplibregl.Marker({ element: person }).setLngLat([user.lng, user.lat]).addTo(map));
    }
    for (const place of places) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = place.selected ? 'place-pin selected' : 'place-pin';
      pin.setAttribute('aria-label', place.name);
      pin.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M8 3h8v7a4 4 0 0 1-8 0V3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 14v7M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      pin.onclick = (event) => {
        event.stopPropagation();
        onSelectRef.current(place.id);
      };
      markers.current.push(new maplibregl.Marker({ element: pin }).setLngLat([place.lng, place.lat]).addTo(map));
    }
  }, [places, user]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const data =
        route.length > 1
          ? {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: route.map((point) => [point.lng, point.lat]),
              },
            }
          : { type: 'FeatureCollection' as const, features: [] };
      const existing = map.getSource('route') as GeoJSONSource | undefined;
      if (existing) existing.setData(data);
      else {
        map.addSource('route', { type: 'geojson', data });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#18181b', 'line-width': 5 },
        });
      }
      if (route.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const point of route) bounds.extend([point.lng, point.lat]);
        map.fitBounds(bounds, { padding: { top: 72, bottom: 220, left: 48, right: 48 }, duration: 800, maxZoom: 15 });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [route]);

  return <div ref={holder} className={`map-shell absolute inset-0 ${dropMode ? 'cursor-crosshair' : ''}`} />;
}
