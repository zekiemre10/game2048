import { Component, HostListener, computed, inject } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { BoardComponent } from './components/board/board';
import { GameService } from './services/game.service';
import { ThemeService } from './services/theme.service';
import { Direction, GameStatus } from './models/tile.model';
import { swipeDirection } from './logic/swipe';
import { formatTime } from './logic/format-time';

/** Ok tuşu → yön eşlemesi. */
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowLeft: Direction.Left,
  ArrowRight: Direction.Right,
  ArrowUp: Direction.Up,
  ArrowDown: Direction.Down,
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StartScreen, BoardComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly game = inject(GameService);
  private readonly themeService = inject(ThemeService);

  /** Şablonda kullanmak için durumları dışa aç. */
  protected readonly status = this.game.status;
  protected readonly score = this.game.score;
  protected readonly bestScore = this.game.bestScore;
  protected readonly canUndo = this.game.canUndo;
  protected readonly moves = this.game.moves;
  protected readonly elapsedSeconds = this.game.elapsedSeconds;
  protected readonly theme = this.themeService.theme;
  protected readonly GameStatus = GameStatus;

  /** Geçen süreyi mm:ss biçiminde döndürür (şablonda gösterim için). */
  protected readonly elapsedLabel = computed(() => formatTime(this.elapsedSeconds()));

  /** Dokunmatik kaydırmanın başlangıç noktası. */
  private touchStartX = 0;
  private touchStartY = 0;

  // --- Klavye -------------------------------------------------

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const direction = KEY_TO_DIRECTION[event.key];
    if (!direction) return;
    event.preventDefault();
    this.tryMove(direction);
  }

  // --- Dokunmatik (mobil) -------------------------------------

  @HostListener('window:touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  }

  @HostListener('window:touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;

    const direction = swipeDirection(dx, dy);
    if (direction) {
      this.tryMove(direction);
    }
  }

  // --- Ortak giriş noktası ------------------------------------

  /** Girişleri tek noktadan hamleye çevirir (kilit kontrolü burada). */
  private tryMove(direction: Direction): void {
    // Oyun bitince (Won/Lost) veya başlamadan giriş alınmaz.
    if (this.status() !== GameStatus.Playing) return;
    this.game.move(direction);
  }

  /** Yeni oyun / yeniden başlat. */
  onRestart(): void {
    this.game.startGame();
  }

  /** Kazandıktan sonra oyuna devam et. */
  onContinue(): void {
    this.game.continueAfterWin();
  }

  /** Son hamleyi geri al. */
  onUndo(): void {
    this.game.undo();
  }

  /** Açık ↔ koyu tema geçişi (tercih kalıcı kaydedilir). */
  onToggleTheme(): void {
    this.themeService.toggle();
  }
}
