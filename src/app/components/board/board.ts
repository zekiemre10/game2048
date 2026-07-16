import { Component, inject } from '@angular/core';
import { GameService } from '../../services/game.service';
import { TileComponent } from '../tile/tile';
import { BOARD_SIZE, Tile } from '../../models/tile.model';

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

  /** Bomba hedefleme modu (kareleri tıklanabilir yapar). */
  readonly bombMode = this.game.bombMode;

  /** Zemindeki boş hücreler (4×4 = 16 adet, yalnızca görsel). */
  readonly backgroundCells = Array.from({ length: BOARD_SIZE * BOARD_SIZE });

  /** Bomba modundayken bir kareye tıklanınca onu siler. */
  onTileClick(tile: Tile): void {
    if (this.bombMode()) {
      this.game.removeTileAt(tile.row, tile.col);
    }
  }
}
