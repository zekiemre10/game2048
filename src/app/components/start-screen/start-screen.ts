import { Component, inject } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'app-start-screen',
  standalone: true,
  imports: [],
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.scss',
})
export class StartScreen {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  /** Statik metin çevirisi. */
  protected readonly t = (key: string) => this.i18n.t(key);

  /** Ulaşılan en yüksek seviye (kayıt gösterimi için). */
  protected readonly bestLevel = this.game.bestLevel;

  /** Toplam altın. */
  protected readonly gold = this.game.gold;

  /** "Başla" → klasik sonsuz oyun. */
  onStart(): void {
    this.game.startGame();
  }

  /** "Seviye Modu" → hedef + geri sayımlı seviyeler. */
  onStartLevel(): void {
    this.game.startLevelMode();
  }
}
