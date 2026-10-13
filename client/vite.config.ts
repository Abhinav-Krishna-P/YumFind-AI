import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
          if (/[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
