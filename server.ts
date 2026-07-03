import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { registerApi } from './server/api';
import { loadRuntimeConfig } from './server/config';

dotenv.config();

async function startServer(): Promise<void> {
  const app = express();
  const config = loadRuntimeConfig();
  await registerApi(app, config);

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.message });
      return;
    }
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Beklenmeyen sunucu hatası.',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '127.0.0.1', () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
