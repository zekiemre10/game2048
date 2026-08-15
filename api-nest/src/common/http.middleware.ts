import { Request, Response, NextFunction } from 'express';

const PREFIXES = ['/emre/2048/api', '/api'];

/**
 * app.py _path + CORS + güvenlik başlıkları + OPTIONS 204 — tek express ara
 * katmanı. Yönlendirmeden ÖNCE çalışır: yol ön-ekini (bir kez) soyar, böylece
 * denetleyiciler çıplak yolları kullanır (/rooms/create hem /api/... hem çıplak
 * gelebilir). CORS beyaz listesi dışı köken asla yansıtılmaz (hiç "*" yok).
 */
export function makeHttpMiddleware(corsOrigins: Set<string>) {
  return function httpMiddleware(req: Request, res: Response, next: NextFunction): void {
    // --- Güvenlik başlıkları (her yanıt) — app.py:1000-1003 ---
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // --- CORS — yalnız beyaz listedeki köken yansıtılır ---
    const origin = req.header('origin');
    if (origin && corsOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    // --- Preflight ---
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    // --- Yol ön-eki soyma (bir kez) + sondaki / sadeleştir ---
    const qIdx = req.url.indexOf('?');
    let path = qIdx >= 0 ? req.url.slice(0, qIdx) : req.url;
    const query = qIdx >= 0 ? req.url.slice(qIdx) : '';
    for (const p of PREFIXES) {
      if (path === p || path.startsWith(p + '/')) {
        path = path.slice(p.length) || '/';
        break;
      }
    }
    if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
    req.url = path + query;

    next();
  };
}
