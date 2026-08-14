import { Injectable, computed, inject, signal } from '@angular/core';
import { Direction } from '../models/tile.model';
import { Puzzle } from '../logic/puzzle.model';
import { PUZZLES } from '../logic/puzzles.data';
import { puzzleGoalReached, puzzleHint } from '../logic/puzzle-logic';
import { BoardStore } from './board-store';
import { loadPuzzleProgress, savePuzzleProgress } from './game-storage';

/**
 * Bulmaca modu DURUMU: kayıt defteri (derleme zamanı üretimi), anlık bulmaca,
 * ilerleme (id → en iyi hamle derecesi) ve ipucu. Tahtayı okumak için
 * BoardStore'a bağlıdır (yaprak); çekirdeğe bağlı DEĞİL → döngü yok. Ödül/oyun
 * sonu akışını GameEngine yönetir (bu servisi enjekte eder).
 */
@Injectable({ providedIn: 'root' })
export class PuzzleService {
  private readonly board = inject(BoardStore);

  /** Tüm bulmacalar (derleme zamanında üretildi, çözülebilirliği doğrulandı). */
  readonly puzzles: readonly Puzzle[] = PUZZLES;

  /** Bölüm → o bölümün bulmacaları (seçim ekranı için). */
  readonly sections = computed(() => {
    const map = new Map<number, Puzzle[]>();
    for (const p of this.puzzles) {
      const arr = map.get(p.section) ?? [];
      arr.push(p);
      map.set(p.section, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([section, list]) => ({ section, list }));
  });

  /** Anlık oynanan bulmaca (yoksa null). */
  readonly current = signal<Puzzle | null>(null);

  /** İlerleme: bulmaca id → en iyi (en az) çözüm hamlesi. */
  readonly progress = signal<Record<string, number>>(loadPuzzleProgress());

  /** Çözülen bulmaca sayısı. */
  readonly solvedCount = computed(() => Object.keys(this.progress()).length);

  isSolved(id: string): boolean {
    return this.progress()[id] !== undefined;
  }

  /** Bir bulmacanın en iyi derecesi (çözülmediyse null). */
  bestMoves(id: string): number | null {
    return this.progress()[id] ?? null;
  }

  /** Anlık bulmacayı ayarlar (tahta yüklemesini ModesService yapar). */
  setCurrent(p: Puzzle): void {
    this.current.set(p);
  }

  /** Anlık bulmacanın hedefi sağlandı mı? (tahtadan). */
  goalReached(): boolean {
    const p = this.current();
    if (!p) return false;
    return puzzleGoalReached(p, this.board.toValueGrid(), this.board.score());
  }

  /**
   * Bulmaca çözüldü: en iyi dereceyi kaydeder (yalnızca daha iyiyse).
   * @returns firstSolve = ilk kez mi çözüldü; perfect = asgari hamlede mi.
   */
  recordSolved(moves: number): { firstSolve: boolean; perfect: boolean } {
    const p = this.current();
    if (!p) return { firstSolve: false, perfect: false };
    const prev = this.progress()[p.id];
    const firstSolve = prev === undefined;
    if (prev === undefined || moves < prev) {
      this.progress.update((m) => {
        const next = { ...m, [p.id]: moves };
        savePuzzleProgress(next);
        return next;
      });
    }
    return { firstSolve, perfect: moves <= p.minMoves };
  }

  /** İpucu: mevcut tahtadan hedefe götüren en kısa çözümün ilk hamlesi. */
  hint(): Direction | null {
    const p = this.current();
    if (!p) return null;
    const remaining = p.moveBudget - this.board.moves();
    return puzzleHint(p, this.board.toValueGrid(), this.board.score(), remaining);
  }
}
