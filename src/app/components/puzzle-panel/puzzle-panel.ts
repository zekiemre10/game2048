import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { Puzzle } from '../../logic/puzzle.model';

/**
 * Bulmaca seçim paneli: bölümlere göre gruplanmış, YZ üretimli bulmacalar.
 * Her kart türü + hedefi + (çözüldüyse) en iyi dereceyi gösterir. Bir bulmacaya
 * tıklayınca oyun başlar ve panel kapanır. Açık/kapalı durumunu App yönetir.
 */
@Component({
  selector: 'app-puzzle-panel',
  standalone: true,
  templateUrl: './puzzle-panel.html',
  styleUrl: './puzzle-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PuzzlePanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly sections = this.game.puzzleSections;
  protected readonly solvedCount = this.game.puzzleSolvedCount;
  protected readonly total = this.game.puzzleTotal;

  /** Türe göre simge. */
  protected icon(p: Puzzle): string {
    return p.type === 'tile' ? '🔷' : p.type === 'score' ? '💯' : '🧹';
  }

  /** Bulmaca hedefinin kısa metni (tür + hedef + bütçe). */
  protected goalText(p: Puzzle): string {
    return this.t('puzzle.goal.' + p.type, { n: p.moveBudget, t: p.target });
  }

  /** Bulmaca numarası (id'den, örn. p007 → 7). */
  protected num(p: Puzzle): number {
    return Number(p.id.slice(1));
  }

  protected isSolved(id: string): boolean {
    return this.game.isPuzzleSolved(id);
  }

  protected bestMoves(id: string): number | null {
    return this.game.puzzleBestMoves(id);
  }

  /** Bir bulmacayı oyna: oyunu başlat + paneli kapat. */
  onPlay(p: Puzzle): void {
    this.game.startPuzzle(p);
    this.close.emit();
  }
}
