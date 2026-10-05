import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Forward API calls to the local Express server (cd server && npm run dev)
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    // Keep CRA's output folder so vercel.json and server.js don't change
    outDir: 'build'
  }
});
