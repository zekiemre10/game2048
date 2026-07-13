import { Component, computed, input } from '@angular/core';
import { Tile } from '../../models/tile.model';

@Component({
  selector: 'app-tile',
  standalone: true,
  imports: [],
  templateUrl: './tile.html',
  styleUrl: './tile.scss',
  host: {
    // Konumu CSS değişkenleri olarak host'a aktar → SCSS transform ile yerleşir
    '[style.--row]': 'tile().row',
    '[style.--col]': 'tile().col',
  },
})
export class TileComponent {
  /** Çizilecek kare (signal input). */
  readonly tile = input.required<Tile>();

  /** Değere göre renk sınıfı: tile-2, tile-4, ... */
  readonly colorClass = computed(() => `tile-${this.tile().value}`);

  /** Bu hamlede yeni oluştuysa "beliriş" animasyonu için sınıf. */
  readonly isNew = computed(() => this.tile().isNew === true);
}
