import { Injectable } from '@angular/core';
import { API_BASE } from './auth.service';

/**
 * Anonim telemetri: metrik panosu (📈) için oyun olayları gönderir.
 * Ateşle-unut — oyunu ASLA bloklamaz, hata yutar. Kişisel veri göndermez
 * (yalnız olay adı + mod/level/score). Sunucu tarafı `POST /events` (auth'suz).
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  /** Olay gönder (ör. game_start {mode}). Sonuç beklenmez.
   *
   * `navigator.sendBeacon` kullanır: ateşle-unut telemetri için DOĞRU API —
   * bloklamaz, açık bağlantı bırakmaz, oyunu/sayfayı yavaşlatmaz. jsdom/SSR'de
   * (birim testleri) sendBeacon YOKTUR → sessizce atlanır (test ağ çağrısı
   * yapmaz, takılmaz). Gerçek tarayıcı + Playwright'ta çalışır. */
  event(name: string, payload: Record<string, unknown> = {}): void {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
        return; // test/SSR ortamı — ağ çağrısı yapma
      }
      const body = new Blob([JSON.stringify({ name, ...payload })], {
        type: 'application/json',
      });
      navigator.sendBeacon(`${API_BASE}/events`, body);
    } catch {
      /* telemetri kritik değil — sessizce geç */
    }
  }
}
