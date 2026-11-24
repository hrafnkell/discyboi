import { defineConfig } from 'vite';

const api = { target: 'http://127.0.0.1:8787', changeOrigin: false, xfwd: true };

export default defineConfig({
  base: './',
  // Listen on all interfaces and accept any Host header (LAN IPs, hostnames, tunnels).
  // Web Bluetooth still needs a secure context: localhost or https.
  // /api and /firmware go to the discyboi server (bun run server).
  server: { host: true, port: 5173, allowedHosts: true, proxy: { '/api': api, '/firmware': api } },
  preview: { host: true, allowedHosts: true, proxy: { '/api': api, '/firmware': api } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: { main: 'index.html', throws: 'throws.html' } },
  },
});
