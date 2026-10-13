import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app: a manifest plus a service worker that keeps the app shell on the device.
    VitePWA({
      // The page asks before swapping in a new version, so nobody loses a search mid-way.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'YumFindAI · Food matched to your taste',
        short_name: 'YumFindAI',
        description: "An AI agent that learns your taste, reads this month's Google reviews and picks the places that fit you.",
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#fff5ee',
        theme_color: '#ff4b2b',
        categories: ['food', 'lifestyle', 'travel'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Find food near me', short_name: 'Find food', url: '/dashboard', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'My profile', short_name: 'Profile', url: '/profile', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      workbox: {
        // The app shell, including the map code, so the installed app opens instantly and offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        globIgnores: ['og-image.png', 'brand/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Deep links like /dashboard open from the cached shell; the API is always live.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * DAY }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // Map style, vector tiles, glyphs and sprites: the streets you looked at stay drawn offline.
            urlPattern: /^https:\/\/(tiles\.openfreemap\.org|[a-d]?\.?basemaps\.cartocdn\.com)\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 600, maxAgeSeconds: 14 * DAY }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'food-photos', expiration: { maxEntries: 60, maxAgeSeconds: 30 * DAY }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
      // No service worker while developing: it would serve stale files over hot reload.
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  envDir: path.resolve(__dirname, '..'),
  // A fixed port keeps the same origin, so the saved login is still there after a restart.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    target: 'es2020',
    // MapLibre alone is ~1 MB and only loads on the map page; don't warn about it.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Big libraries get their own files, so a code change doesn't make phones re-download them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('@supabase')) return 'supabase';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
