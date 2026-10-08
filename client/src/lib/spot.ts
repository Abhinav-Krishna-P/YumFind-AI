import { api } from './api';

/** Where the user is, shared by Home and the map so they are only asked once per visit. */
export type Spot = { lat: number; lng: number; label: string | null; at: number };

const KEY = 'yf-spot';
const FRESH_MS = 30 * 60 * 1000;

/** The last known position from this browser session, if it is under 30 minutes old. */
export function readSpot(): Spot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as Spot;
    const valid = Number.isFinite(spot.lat) && Number.isFinite(spot.lng) && Date.now() - spot.at < FRESH_MS;
    return valid ? spot : null;
  } catch {
    return null;
  }
}

export function saveSpot(spot: { lat: number; lng: number; label: string | null }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...spot, at: Date.now() }));
  } catch {
    // Storage blocked: the map will simply ask again.
  }
}

/** "Kozhikode" style name for a coordinate, or null when the lookup fails. */
export async function placeNameFor(lat: number, lng: number) {
  try {
    return (await api<{ label: string | null }>('/api/where', { lat, lng })).label;
  } catch {
    return null;
  }
}

/** Browser geolocation as a promise, with a message fit for the UI when it fails. */
export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share your location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        reject(
          new Error(error.code === error.PERMISSION_DENIED ? 'Location is blocked for this site.' : "Couldn't get a location fix. Try again in a moment."),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
