import { Component, inject } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { GameService } from './services/game.service';
import { GameStatus } from './models/tile.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StartScreen],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly game = inject(GameService);

  /** Şablonda kullanmak için durumları dışa aç. */
  protected readonly status = this.game.status;
  protected readonly GameStatus = GameStatus;
}
