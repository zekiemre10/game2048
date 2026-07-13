import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { Tile } from '../../models/tile.model';

@Component({
  selector: 'app-tile',
  standalone: true,
  imports: [],
  templateUrl: './tile.html',
  styleUrl: './tile.scss',
  host: {
    // Konumu CSS değişkenleri olarak host'a aktar → SCSS transform ile yerleşir.
    // Kare id'si korunduğu için (track id) bu değişim transition ile KAYAR.
    '[style.--row]': 'tile().row',
    '[style.--col]': 'tile().col',
  },
})
export class TileComponent {
  /** Çizilecek kare (signal input). */
  readonly tile = input.required<Tile>();

  private readonly host = inject(ElementRef);

  /** Bu hamlede yeni oluştuysa "pop-in" animasyonu için. */
  readonly isNew = computed(() => this.tile().isNew === true);

  constructor() {
    // Birleşme "bump" animasyonu.
    // Sınıf bağlaması ([class.is-merged]) yeterli DEĞİL: aynı kare üst üste
    // iki hamlede birleşirse sınıf zaten ekli kalır ve animasyon tekrar
    // çalışmaz. Bu yüzden sınıfı kaldırıp reflow tetikleyerek yeniden ekliyoruz.
    effect(() => {
      const merged = this.tile().merged === true;
      const inner: HTMLElement | null = (
        this.host.nativeElement as HTMLElement
      ).querySelector('.tile');
      if (!inner) return;

      inner.classList.remove('is-merged');
      if (merged) {
        void inner.offsetWidth; // reflow → animasyonu baştan başlat
        inner.classList.add('is-merged');
      }
    });
  }
}
