import { Component, HostListener, inject } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { BoardComponent } from './components/board/board';
import { GameService } from './services/game.service';
import { Direction, GameStatus } from './models/tile.model';
import { swipeDirection } from './logic/swipe';

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

  /** Şablonda kullanmak için durumları dışa aç. */
  protected readonly status = this.game.status;
  protected readonly score = this.game.score;
  protected readonly GameStatus = GameStatus;

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
}
