import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Keep the frontend dev proxy aligned with the gateway port in the repo root `.env`.
// (Vite only loads env files from its own root by default.)
const rootEnvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath });

const apiPort = Number(process.env.PORT) || 3000;
const apiOrigin = process.env.VITE_API_ORIGIN || `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiOrigin, changeOrigin: true },
      '/files': { target: apiOrigin, changeOrigin: true },
      '/socket.io': { target: apiOrigin, ws: true, changeOrigin: true },
    },
  },
});
