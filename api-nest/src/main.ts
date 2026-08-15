import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { makeHttpMiddleware } from './common/http.middleware';
import { MAX_BODY } from './common/constants';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Gövde sınırı (app.py MAX_BODY 256KB). Ham JSON.
  app.use(json({ limit: MAX_BODY }));
  // CORS + güvenlik başlıkları + yol ön-eki soyma + OPTIONS 204.
  app.use(makeHttpMiddleware(cfg.corsOrigins));

  // nginx loopback'te fronter; app.py gibi 127.0.0.1'e bağlan.
  await app.listen(cfg.port, '127.0.0.1');
  // eslint-disable-next-line no-console
  console.log(`game2048 NestJS API 127.0.0.1:${cfg.port} (db=${cfg.dbName})`);
}
bootstrap();
