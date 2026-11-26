import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const api = { target: 'http://127.0.0.1:8787', changeOrigin: false, xfwd: true };

/**
 * The board's placement map lives with the hardware (v4/assembly.html, a page fragment without a
 * document skeleton). Serve it as /build/assembly.html with one, in dev and in the build.
 */
function assemblyMap(): Plugin {
  const src = resolve(__dirname, '../v4/assembly.html');
  const page = () =>
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<meta name="robots" content="noindex" />\n</head>\n<body>\n' +
    readFileSync(src, 'utf8') +
    '\n</body>\n</html>\n';
  return {
    name: 'assembly-map',
    configureServer(server) {
      server.middlewares.use('/build/assembly.html', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(page());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build/assembly.html', source: page() });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [assemblyMap()],
  // Listen on all interfaces and accept any Host header (LAN IPs, hostnames, tunnels).
  // Web Bluetooth still needs a secure context: localhost or https.
  // /api and /firmware go to the discyboi server (bun run server).
  server: { host: true, port: 5173, allowedHosts: true, proxy: { '/api': api, '/firmware': api } },
  preview: { host: true, allowedHosts: true, proxy: { '/api': api, '/firmware': api } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
    // / is the landing page; the app lives under /lab/.
    rollupOptions: { input: { home: 'index.html', main: 'lab/index.html', throws: 'lab/throws.html', build: 'build/index.html', faq: 'faq/index.html' } },
  },
});
