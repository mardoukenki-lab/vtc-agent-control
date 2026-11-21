import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createApiApp } from './src/server/createApp.ts';
import { createFsStorage } from './src/server/storage.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const storage = createFsStorage();
  const app = createApiApp(storage);
  const httpServer = http.createServer(app);

  // Mount Vite in dev or serve dist in production
  if (!IS_PROD) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(
          [
            'export const createHotContext = () => ({ accept(){}, dispose(){}, prune(){}, invalidate(){}, decline(){}, on(){}, off(){}, send(){}, data: {} });',
            'export const updateStyle = (id, content) => {',
            '  let s = document.querySelector(`style[data-vite-dev-id="${CSS.escape(id)}"]`);',
            '  if (!s) { s = document.createElement("style"); s.setAttribute("data-vite-dev-id", id); document.head.appendChild(s); }',
            '  s.textContent = content;',
            '};',
            'export const removeStyle = (id) => { document.querySelector(`style[data-vite-dev-id="${CSS.escape(id)}"]`)?.remove(); };',
            'export const injectQuery = (url) => url;',
            'export class ErrorOverlay {}',
          ].join('\n')
        );
      });
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build front introuvable. Exécutez npm run build.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Allô Dabou · Contrôle server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
