import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv('development', '.', 'VITE_'), ...loadEnv(mode, '.', 'VITE_') };
  const backend = env.VITE_BACKEND_URL;
  if (!backend) throw new Error('VITE_BACKEND_URL must be set in the frontend environment');
  return {
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['temperature-icon.svg', 'apple-touch-icon.png'],
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/health$/, /^\/ws/],
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    },
    manifest: {
      id: '/', name: 'Pride Monitor', short_name: 'Pride Monitor',
      description: 'Live G7 sensor monitoring, alarms, and history',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#0b1f3a', theme_color: '#0b1f3a',
      icons: [
        { src: '/temperature-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/temperature-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/temperature-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  })],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/health': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  };
});
