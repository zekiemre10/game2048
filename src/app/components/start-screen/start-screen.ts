import { Component, inject } from '@angular/core';
import { GameService } from '../../services/game.service';

@Component({
  selector: 'app-start-screen',
  standalone: true,
  imports: [],
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.scss',
})
export class StartScreen {
  private readonly game = inject(GameService);

  /** Ulaşılan en yüksek seviye (kayıt gösterimi için). */
  protected readonly bestLevel = this.game.bestLevel;

  /** "Başla" → klasik sonsuz oyun. */
  onStart(): void {
    this.game.startGame();
  }

  /** "Seviye Modu" → hedef + geri sayımlı seviyeler. */
  onStartLevel(): void {
    this.game.startLevelMode();
  }
}
