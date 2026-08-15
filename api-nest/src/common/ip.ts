import { Request } from 'express';

/** İstemci IP — app.py _ip: X-Forwarded-For ilk atlama, yoksa soket adresi. */
export function clientIp(req: Request): string {
  const xff = req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/** X-Forwarded-For var mı (app.py IP kapısı yalnız bu varken uygulanır). */
export function hasForwardedFor(req: Request): boolean {
  return !!req.header('x-forwarded-for');
}
