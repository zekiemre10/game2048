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

  /** "Başla" butonuna basıldığında oyunu başlatır. */
  onStart(): void {
    this.game.startGame();
  }
}
