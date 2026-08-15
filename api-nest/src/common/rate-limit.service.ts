import { Injectable } from '@nestjs/common';
import { nowSec } from './time';

/**
 * Bellek-içi hız sınırlayıcı — app.py rl() ile birebir (süreç başına, örnekler
 * arası paylaşılmaz). Kova anahtarı (name, key); pencere içi sayım max'ı aşınca
 * reddeder. app.py'deki gibi "izin var mı?" yanıtı verir; çağıran 429 atar.
 */
@Injectable()
export class RateLimitService {
  private buckets = new Map<string, { count: number; reset: number }>();

  /** İzin verilirse true (ve sayaç artar); pencere aşıldıysa false. */
  allow(name: string, key: string | number, max: number, windowSec: number): boolean {
    const now = nowSec();
    const id = `${name}:${key}`;
    const b = this.buckets.get(id);
    if (!b || now >= b.reset) {
      this.buckets.set(id, { count: 1, reset: now + windowSec });
      return true;
    }
    if (b.count >= max) return false;
    b.count++;
    return true;
  }

  /** login gibi başarıda sıfırlanan sayaçlar için. */
  clear(name: string, key: string | number): void {
    this.buckets.delete(`${name}:${key}`);
  }

  /** Tüm kovaları sıfırla (test yalıtımı / operasyonel reset). */
  resetAll(): void {
    this.buckets.clear();
  }
}
