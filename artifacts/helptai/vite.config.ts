import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const port = Number(process.env.PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 8080);
// HTTPS=1 serves over https with a throwaway certificate. Phones only allow the camera on a secure
// page, so this is needed to use the in-app camera from a phone on the same Wi-Fi.
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  // Read the project's single .env at the repo root. Only VITE_* settings reach the browser, so
  // the Gemini keys in that file stay on the server.
  envDir: path.resolve(import.meta.dirname, '..', '..'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    host: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  preview: {
    port,
    host: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
