import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'alarm-page-routes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/') {
          response.writeHead(302, { Location: '/display' });
          response.end();
          return;
        }
        if (request.url === '/display' || request.url?.startsWith('/display?')) {
          request.url = request.url.replace('/display', '/display.html');
        } else if (request.url === '/settings' || request.url?.startsWith('/settings?')) {
          request.url = request.url.replace('/settings', '/settings.html');
        }
        if (request.url === '/engineering' || request.url?.startsWith('/engineering?')) {
          request.url = request.url.replace('/engineering', '/engineering.html');
        }
        next();
      });
    },
  }],
  build: {
    target: 'es2017',
    rollupOptions: {
      input: {
        settings: resolve(import.meta.dirname, 'settings.html'),
        display: resolve(import.meta.dirname, 'display.html'),
        engineering: resolve(import.meta.dirname, 'engineering.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3006',
      '/uploads': 'http://127.0.0.1:3006',
      '/socket.io': { target: 'http://127.0.0.1:3006', ws: true },
    },
  },
});
