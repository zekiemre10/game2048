import { Injectable, signal } from '@angular/core';
import { GameStatus } from '../models/tile.model';

// ============================================================
//  2048 — Oyun servisi (iskelet)
//  Not: Tahta mantığı (hamle, birleştirme, skor) sonraki
//  adımlarda bu servise eklenecek. Şu an sadece durum yönetimi
//  ve başlık ekranından oyuna geçiş için temel iskelet var.
// ============================================================

@Injectable({ providedIn: 'root' })
export class GameService {
  /** Oyunun anlık durumu. */
  readonly status = signal<GameStatus>(GameStatus.Idle);

  /** Anlık skor. */
  readonly score = signal<number>(0);

  /** En yüksek skor (sonraki adımda localStorage'a bağlanacak). */
  readonly bestScore = signal<number>(0);

  /** Başlık ekranından yeni oyunu başlatır. */
  startGame(): void {
    this.score.set(0);
    this.status.set(GameStatus.Playing);
    // TODO: tahtayı sıfırla + iki başlangıç taşı ekle
  }

  /** Oyunu başlık ekranına döndürür. */
  reset(): void {
    this.status.set(GameStatus.Idle);
    this.score.set(0);
  }
}
