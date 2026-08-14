import { Injectable, computed, inject, signal } from '@angular/core';
import { Direction, GameStatus } from '../models/tile.model';
import {
  MoveReview,
  TimelinePoint,
  ValueGrid,
  bestMove,
  positionHealth,
  reviewMove,
} from '../logic/ai';
import { BoardStore } from './board-store';
import { TimerService } from './timer.service';
import { loadAssistant, saveAssistant } from './game-storage';

/** Bir oyunda verilebilecek en fazla öneri sayısı. */
export const ASSIST_HINT_QUOTA = 5;

/**
 * YZ asistanı DURUMU: açık/kapalı anahtarı, hamle kalitesi değerlendirmesi,
 * pozisyon sağlığı, oyun-başına sınırlı öneri ve otomatik-oynatma bayrakları.
 *
 * Tek sorumluluk = asistan durumu. Tahtayı okumak için BoardStore'a, "duraklat"
 * için TimerService'e bağlıdır (ikisi de yaprak). Otomatik oynatma MOTORU
 * (`move` süren döngü) burada DEĞİL; bu servis çekirdeğe bağlı olmadığından
 * (yalnız durum tutar) döngü oluşmaz.
 */
@Injectable({ providedIn: 'root' })
export class AssistantStore {
  private readonly board = inject(BoardStore);
  private readonly timer = inject(TimerService);

  /** Asistan açık mı? (Ayarlar'daki anahtar) */
  readonly assistantOn = signal<boolean>(loadAssistant());

  setAssistant(on: boolean): void {
    this.assistantOn.set(on);
    saveAssistant(on);
    if (!on) this.resetMoveReview();
  }

  // --- Hamle kalitesi + doğruluk ------------------------------

  /** Son hamlenin YZ değerlendirmesi (bir sonraki hamlede yenilenir). */
  readonly lastMoveReview = signal<MoveReview | null>(null);

  /** Bu oyundaki hamle kalitesi sayaçları. */
  readonly moveRatings = signal({ best: 0, good: 0, inaccurate: 0 });

  /** Değerlendirilen toplam hamle. */
  readonly ratedMoves = computed(() => {
    const r = this.moveRatings();
    return r.best + r.good + r.inaccurate;
  });

  /** Doğruluk yüzdesi: en iyi + yakın hamlelerin oranı. */
  readonly accuracy = computed(() => {
    const total = this.ratedMoves();
    if (total === 0) return 100;
    const r = this.moveRatings();
    return Math.round(((r.best + r.good) / total) * 100);
  });

  /** Tahtanın anlık sağlığı (arama yapmaz, ucuzdur). */
  readonly health = computed(() => positionHealth(this.board.toValueGrid()));

  resetMoveReview(): void {
    this.lastMoveReview.set(null);
    this.moveRatings.set({ best: 0, good: 0, inaccurate: 0 });
  }

  /**
   * Bir insan hamlesini değerlendirir (asistan açıkken, tahta DEĞİŞMEDEN önce).
   * Çekirdek `move()` bunu hamleyi uygulamadan hemen önce çağırır.
   * @returns değerlendirme (asistan kapalı/YZ oynuyorsa null) — zaman çizelgesi için.
   */
  recordReview(direction: Direction): MoveReview | null {
    if (!this.assistantOn() || this.autoplaying()) return null;
    const review = reviewMove(this.board.toValueGrid(), direction, 'medium');
    this.lastMoveReview.set(review);
    if (review) {
      this.moveRatings.update((r) => ({ ...r, [review.rating]: r[review.rating] + 1 }));
    }
    return review;
  }

  // --- Oyun sonu hamle zaman çizelgesi ------------------------

  /** Uzun oyunlarda bellek koruması için tutulan en fazla nokta (aşınca seyreltilir). */
  private static readonly MAX_TIMELINE = 600;

  /**
   * Bu oyunun hamle zaman çizelgesi: her hamlenin sağlığı + kalitesi + karar-anı
   * tahtası. Oyun-sonu grafiği bunu çizer. Asistan KAPALIYKEN de dolar (sağlık
   * eğrisi asistana bağlı değil); yalnız kalite/öneri null olur.
   */
  readonly moveTimeline = signal<TimelinePoint[]>([]);

  /**
   * Hamle uygulandıktan SONRA çağrılır: sağlığı (hamle sonrası) + skoru ölçüp
   * karar-anı ızgarasıyla (preGrid) birlikte çizelgeye ekler. YZ gösterimi
   * (autoplay) sayılmaz. Yeni oyunun ilk hamlesinde çizelge sıfırlanır.
   */
  recordTimelinePoint(preGrid: ValueGrid, direction: Direction, review: MoveReview | null): void {
    if (this.autoplaying()) return; // gösterim hamleleri sayılmaz
    const point: TimelinePoint = {
      move: this.board.moves(),
      direction,
      rating: review?.rating ?? null,
      best: review?.best ?? null,
      health: positionHealth(this.board.toValueGrid()).score, // hamle SONRASI
      score: this.board.score(),
      grid: preGrid,
    };
    this.moveTimeline.update((list) => {
      const next = [...list, point];
      // Bellek koruması: çok uzun oyunlarda her ikinci noktayı tutarak seyrelt.
      return next.length > AssistantStore.MAX_TIMELINE * 2
        ? next.filter((_, i) => i % 2 === 0)
        : next;
    });
  }

  /** Yeni oyun: öneri hakları + hamle değerlendirmesi + zaman çizelgesi sıfırlanır. */
  startNewGame(): void {
    this.aiAssisted.set(false);
    this.resetHints();
    this.resetMoveReview();
    this.moveTimeline.set([]);
  }

  // --- Oyun başına sınırlı öneri ------------------------------

  /** Bu oyunda kalan öneri hakkı. */
  readonly assistHintsLeft = signal(ASSIST_HINT_QUOTA);

  /** Şu an gösterilen öneri yönü (hamle yapılınca temizlenir). */
  readonly assistHintDir = signal<Direction | null>(null);

  /** Öneri iste: hak varsa en iyi hamleyi hesaplar ve bir hak düşer. */
  requestHint(): void {
    if (this.board.status() !== GameStatus.Playing) return;
    if (this.timer.paused() || this.autoplaying()) return;
    if (this.assistHintsLeft() <= 0) return;
    const dir = bestMove(this.board.toValueGrid(), 'expert');
    if (!dir) return;
    this.assistHintDir.set(dir);
    this.assistHintsLeft.update((n) => n - 1);
  }

  /** Yeni oyunda öneri hakkını yenile. */
  resetHints(): void {
    this.assistHintsLeft.set(ASSIST_HINT_QUOTA);
    this.assistHintDir.set(null);
  }

  // --- Otomatik oynatma bayrakları (motor çekirdekte) ---------

  /** YZ şu an otomatik mi oynuyor? */
  readonly autoplaying = signal(false);

  /**
   * Bu oyunda YZ EN AZ BİR hamle yaptı mı? Yalnızca yeni oyun başlayınca
   * sıfırlanır (anlık `autoplaying` tek başına yetmez).
   */
  readonly aiAssisted = signal(false);

  /** Gösterim bitince YZ'nin ulaştığı skor (kısa süre gösterilir). */
  readonly aiDemoResult = signal<number | null>(null);

  /** İlerleme (rekor, görev, istatistik, altın) sayılmamalı mı? */
  aiPlayed(): boolean {
    return this.autoplaying() || this.aiAssisted();
  }
}
