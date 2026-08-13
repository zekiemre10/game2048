import { Injectable, inject, signal } from '@angular/core';
import { GameMode, GameStatus } from '../models/tile.model';
import { BoardStore } from './board-store';

/**
 * Süre yönetimi: yukarı sayan süre (Klasik), geri sayım (Seviye/Zaman Yarışı/
 * Yarış/Günlük) ve duraklat/devam. Tahta durumunu BoardStore'dan OKUR; geri
 * sayım bitince oyun-sonu KARARINI çekirdeğe bırakır (`onExpire` geri çağrısı) —
 * böylece çekirdeğe bağımlılık (dolayısıyla döngü) olmaz.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly board = inject(BoardStore);

  /** Bu oyunda geçen süre (saniye). */
  readonly elapsedSeconds = signal<number>(0);
  /** (Geri sayımlı modlar) kalan süre (saniye). */
  readonly remainingSeconds = signal<number>(0);
  /** Oyun duraklatıldı mı? (sayaç durur, giriş kilitlenir, tahta örtülür) */
  readonly paused = signal<boolean>(false);

  /** Geri sayımın toplam süresi (saniye) — +30 gücü bunu artırır. */
  private countdownTotalValue = 0;
  /** Geri sayım yeniden başlatılırken korunan "geçen süre" birikimi (saniye). */
  private elapsedOffset = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private startTimestamp = 0;

  /** Geri sayım 0'a ulaşınca (hâlâ oynanıyorsa) çağrılır; oyun-sonunu çekirdek işler. */
  onExpire: () => void = () => {};

  /** Autoplay anlık görüntüsü için geri sayım toplamı. */
  get countdownTotal(): number {
    return this.countdownTotalValue;
  }

  /** Yukarı sayan süre (Klasik): belirtilen saniyeden ileri sayar. */
  startUp(fromSeconds: number): void {
    this.stopTimer();
    this.elapsedSeconds.set(fromSeconds);
    this.startTimestamp = Date.now() - fromSeconds * 1000;

    // Tarayıcı dışı ortamda (SSR/test) setInterval yoksa sessizce geç.
    if (typeof setInterval === 'undefined') return;
    this.timerId = setInterval(() => {
      this.elapsedSeconds.set(Math.floor((Date.now() - this.startTimestamp) / 1000));
    }, 250);
  }

  /**
   * Geri sayım: belirtilen saniyeden 0'a sayar. 0'a ulaşınca — hâlâ oynanıyorsa
   * — `onExpire` çağrılır (çekirdek durumu Failed/Lost yapıp istatistik işler).
   */
  startCountdown(seconds: number, fromElapsed = 0): void {
    this.stopTimer();
    this.startTimestamp = Date.now();
    this.countdownTotalValue = seconds; // +30 gücü bunu artırabilir
    // Duraklat/devam ve geri alma sonrasında geçen süre sıfırlanmaz:
    // geri sayım kalan süreden, "geçen süre" göstergesi ise birikimden sürer.
    this.elapsedOffset = fromElapsed;
    this.elapsedSeconds.set(fromElapsed);
    this.remainingSeconds.set(seconds);

    if (typeof setInterval === 'undefined') return;
    this.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTimestamp) / 1000);
      this.elapsedSeconds.set(this.elapsedOffset + elapsed);
      const remaining = Math.max(0, this.countdownTotalValue - elapsed);
      this.remainingSeconds.set(remaining);

      if (remaining <= 0) {
        this.stopTimer();
        if (this.board.status() === GameStatus.Playing) this.onExpire();
      }
    }, 250);
  }

  /** Mevcut moda uygun sayacı kaldığı yerden sürdürür. */
  resumeForMode(): void {
    const m = this.board.mode();
    if (m === GameMode.Zen) {
      this.stopTimer(); // süresiz mod
      return;
    }
    if (m === GameMode.Classic) {
      this.startUp(this.elapsedSeconds()); // yukarı sayan
      return;
    }
    // Level / TimeAttack / Race / Daily → kalan süreden geri sayım
    this.startCountdown(this.remainingSeconds(), this.elapsedSeconds());
  }

  /** +30 gücü: geri sayım toplamını ve kalan süreyi artırır. */
  addTime(seconds: number): void {
    this.countdownTotalValue += seconds;
    this.remainingSeconds.update((r) => r + seconds);
  }

  /** Autoplay geri yüklemesi: süre değerlerini olduğu gibi geri koyar. */
  restore(elapsed: number, remaining: number, total: number): void {
    this.elapsedSeconds.set(elapsed);
    this.remainingSeconds.set(remaining);
    this.countdownTotalValue = total;
  }

  /** Süre göstergelerini sıfırlar (Zen / yeni oyun). */
  resetTimes(): void {
    this.elapsedSeconds.set(0);
    this.remainingSeconds.set(0);
  }

  // --- Duraklat / Devam --------------------------------------

  /** Duraklat/Devam arasında geçiş (yalnızca oynanırken). */
  togglePause(): void {
    if (this.board.status() !== GameStatus.Playing) return;
    if (this.paused()) this.resumeGame();
    else this.pauseGame();
  }

  /** Oyunu duraklat: sayacı dondur. */
  pauseGame(): void {
    if (this.paused() || this.board.status() !== GameStatus.Playing) return;
    this.paused.set(true);
    this.stopTimer();
  }

  /** Oyuna devam et: sayacı kaldığı yerden sürdür. */
  resumeGame(): void {
    if (!this.paused()) return;
    this.paused.set(false);
    this.resumeForMode();
  }

  /** Süre sayacını durdurur. */
  stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
