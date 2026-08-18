import { Injectable } from '@angular/core';
import { API_BASE } from './auth.service';

/**
 * Anonim telemetri: metrik panosu (📈) için oyun olayları gönderir.
 * Ateşle-unut — oyunu ASLA bloklamaz, hata yutar. Kişisel veri göndermez
 * (yalnız olay adı + mod/level/score). Sunucu tarafı `POST /events` (auth'suz).
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  /** Olay gönder (ör. game_start {mode}). Sonuç beklenmez. */
  event(name: string, payload: Record<string, unknown> = {}): void {
    try {
      void fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...payload }),
        keepalive: true,
      }).catch(() => {
        /* telemetri kritik değil — sessizce geç */
      });
    } catch {
      /* fetch yoksa/bozuksa sessiz */
    }
  }
}
