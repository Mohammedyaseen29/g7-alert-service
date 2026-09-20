import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv('development', '.', 'VITE_'), ...loadEnv(mode, '.', 'VITE_') };
  const backend = env.VITE_BACKEND_URL;
  if (!backend) throw new Error('VITE_BACKEND_URL must be set in the frontend environment');
  return {
  plugins: [react(), tailwindcss()],
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
