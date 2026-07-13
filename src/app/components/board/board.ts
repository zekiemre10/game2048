import { Component, inject } from '@angular/core';
import { GameService } from '../../services/game.service';
import { TileComponent } from '../tile/tile';
import { BOARD_SIZE } from '../../models/tile.model';

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [TileComponent],
  templateUrl: './board.html',
  styleUrl: './board.scss',
})
export class BoardComponent {
  private readonly game = inject(GameService);

  /** Ekrandaki kareler (signal — track id ile render edilir). */
  readonly tiles = this.game.tiles;

  /** Zemindeki boş hücreler (4×4 = 16 adet, yalnızca görsel). */
  readonly backgroundCells = Array.from({ length: BOARD_SIZE * BOARD_SIZE });
}
