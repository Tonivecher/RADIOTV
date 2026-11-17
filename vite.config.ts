import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'read-only-api-preview',
    configureServer(server) {
      if (!process.env.RADIOTV_PREVIEW_API) return;
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method || '')) {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'В локальном просмотре запись отключена.' }));
          return;
        }
        next();
      });
    },
  }],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.RADIOTV_PREVIEW_API || 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
