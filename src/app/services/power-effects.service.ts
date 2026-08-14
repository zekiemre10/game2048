import { Injectable, inject } from '@angular/core';
import { Cell, Direction, GameMode, GameStatus, Tile } from '../models/tile.model';
import { hasAnyMove } from '../logic/board-logic';
import { bestMove } from '../logic/ai';
import { PowerId } from '../models/power.model';
import { BoardStore } from './board-store';
import { TimerService } from './timer.service';
import { PowersService } from './powers.service';
import { ProfileService } from './profile.service';
import { GameEngine } from './game-engine';
import { ModesService } from './modes.service';

/** +30 saniye gücünün eklediği süre. */
const TIME_POWER_SECONDS = 30;

/**
 * Güç EFEKTLERİ: bir gücü kullanmanın tahta/süre üzerindeki etkisi (bomba,
 * karıştır, geri al, ipucu, +30sn). Envanter/satın alma PowersService'te;
 * burada yalnız etki uygulanır.
 *
 * BoardStore + PowersService + GameEngine (skor/oyun-sonu) + ModesService
 * (geri al) enjekte edilir (tek yön; döngü yok).
 */
@Injectable({ providedIn: 'root' })
export class PowerEffectsService {
  private readonly board = inject(BoardStore);
  private readonly timer = inject(TimerService);
  private readonly powers = inject(PowersService);
  private readonly profile = inject(ProfileService);
  private readonly engine = inject(GameEngine);
  private readonly modes = inject(ModesService);

  /**
   * Bir gücü kullanır (envanterden düşer, etkisini uygular).
   * @returns güç kullanıldıysa true.
   */
  usePower(id: PowerId): boolean {
    if (this.powers.inventory()[id] <= 0) return false;
    if (this.board.status() !== GameStatus.Playing) return false;

    let applied = false;
    switch (id) {
      case 'time':
        applied = this.applyAddTime();
        break;
      case 'bomb':
        // Bomba: hedefleme modunu aç. Güç, kare gerçekten silinince düşer.
        this.powers.bombMode.set(true);
        return true; // henüz tüketilmedi
      case 'shuffle':
        applied = this.applyShuffle();
        break;
      case 'undo':
        applied = this.modes.undo();
        break;
      case 'hint':
        applied = this.applyHint();
        break;
    }

    if (applied) this.consumePower(id);
    return applied;
  }

  /** Bomba hedefleme modundayken bir kareyi siler (gücü tüketir). */
  removeTileAt(row: number, col: number): boolean {
    if (!this.powers.bombMode()) return false;
    const exists = this.board.tiles().some((t) => t.row === row && t.col === col);
    if (!exists) return false;

    this.board.tiles.update((list) => list.filter((t) => !(t.row === row && t.col === col)));
    this.consumePower('bomb');
    this.powers.bombMode.set(false);
    this.board.history.set(null); // geri alma bombalanan kareyi geri getirmesin

    if (this.profile.markBombUsed()) {
      this.engine.checkAchievements(); // "Bombacı" başarımı
    }
    return true;
  }

  /** Bomba modunu iptal eder (güç harcanmaz). */
  cancelBomb(): void {
    this.powers.bombMode.set(false);
  }

  private consumePower(id: PowerId): void {
    this.powers.decrement(id);
    this.engine.trackMission('powers', 1); // görev: güç kullan
    // Güç kullanılan oyun şampiyonluk sıralamasına GİRMEZ (doğrulanamaz + eşit
    // şartlar). Yalnızca sıralama dışı bırakır; oyun normal devam eder.
    this.powers.usedThisGame.set(true);
  }

  /** +30 saniye: yalnızca seviye modunda ve oynanırken. */
  private applyAddTime(): boolean {
    if (this.board.mode() !== GameMode.Level) return false;
    this.timer.addTime(TIME_POWER_SECONDS);
    return true;
  }

  /** Karıştır: mevcut karelerin değerlerini rastgele boş hücrelere dağıtır. */
  private applyShuffle(): boolean {
    const current = this.board.tiles();
    if (current.length === 0) return false;

    const n = this.board.boardSize();
    const cells: Cell[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ row: r, col: c });
    }

    // Karıştırma oyuncunun PARAYLA aldığı bir güç: kendisini oynanamaz bir
    // tahtaya kilitlememeli. Hamlesi kalan bir dizilim bulunana dek dene.
    let shuffled: Tile[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      // id'ler korunur → kareler yeni yerlerine kayarak animasyonla gider.
      shuffled = current.map((t, i) => ({
        id: t.id,
        value: t.value,
        row: cells[i].row,
        col: cells[i].col,
      }));
      if (hasAnyMove(shuffled, n)) break;
    }

    this.board.tiles.set(shuffled);

    // Tahta yine de kilitliyse oyunu usulünce bitir; donmuş ekranda bırakma.
    if (!hasAnyMove(shuffled, n)) {
      this.timer.stopTimer();
      this.board.status.set(
        this.board.mode() === GameMode.Level ? GameStatus.Failed : GameStatus.Lost,
      );
      this.engine.recordGameEnd(false);
    }
    return true;
  }

  /** İpucu: en iyi yönü hesaplayıp kısa süre gösterir. */
  private applyHint(): boolean {
    const dir = this.computeHint();
    if (!dir) return false;
    this.powers.showHint(dir);
    return true;
  }

  /** En iyi hamleyi YZ (expectimax) ile seçer — "sonraki hamle önerisi". */
  private computeHint(): Direction | null {
    return bestMove(this.board.toValueGrid(), 'expert');
  }
}
