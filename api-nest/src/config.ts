import { DEFAULT_CORS_ORIGINS } from './common/constants';

/** Ortam yapılandırması — app.py env değişkenleriyle aynı isimler/varsayılanlar. */
export interface AppConfig {
  mongoUri: string;
  dbName: string;
  port: number;
  corsOrigins: Set<string>;
}

export function loadConfig(): AppConfig {
  const corsRaw = process.env.GAME2048_CORS_ORIGINS || DEFAULT_CORS_ORIGINS;
  return {
    mongoUri: process.env.GAME2048_MONGO_URI || 'mongodb://127.0.0.1:27017',
    dbName: process.env.GAME2048_DB_NAME || 'game2048',
    port: parseInt(process.env.GAME2048_PORT || '8092', 10),
    corsOrigins: new Set(
      corsRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  };
}
