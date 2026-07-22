import { Injectable, inject } from '@angular/core';
import { GameService } from './game.service';
import { I18nService } from './i18n.service';
import { describeGame } from '../logic/ai';

// ============================================================
//  2048 — Yapay zekâ servisi
//  Oyun sonu performans değerlendirmesi. Tamamen algoritmiktir:
//  API anahtarı, ağ isteği ve ücret gerektirmez.
// ============================================================

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  /** Biten oyunu değerlendirir (köşe stratejisi, verimlilik, ipucu). */
  localAnalysis(): string {
    return describeGame(
      this.game.toValueGrid(),
      this.game.score(),
      this.game.moves(),
      // Tüm zamanların rekoru değil, BU oyunda ulaşılan en yüksek kare.
      this.game.currentBestTile(),
      this.i18n.lang(),
    );
  }
}
