import { Component, computed, inject, output, signal } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { BOARD_SIZES, GameMode } from '../../models/tile.model';
import { ACHIEVEMENTS } from '../../models/achievement.model';

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

  protected readonly t = (key: string) => this.i18n.t(key);
  protected readonly GameMode = GameMode;
  protected readonly BOARD_SIZES = BOARD_SIZES;

  /** Seçili tahta boyutu (Klasik/Zen/Zaman Yarışı için). */
  protected readonly selectedSize = signal<number>(4);

  protected readonly bestLevel = this.game.bestLevel;
  protected readonly gold = this.game.gold;

  // --- Başarım şeridi (tam liste App'teki panelde açılır) ----
  /** Şerite tıklandı → App başarımlar panelini açar. */
  readonly openAchievements = output<void>();

  protected readonly ACHIEVEMENTS = ACHIEVEMENTS;
  protected readonly totalCount = ACHIEVEMENTS.length;
  protected readonly unlockedCount = computed(
    () => this.game.unlockedAchievements().size,
  );
  protected readonly percent = computed(() =>
    Math.round((this.unlockedCount() / ACHIEVEMENTS.length) * 100),
  );

  protected isUnlocked(id: string): boolean {
    return this.game.unlockedAchievements().has(id);
  }

  /** Dile göre metin seçer (TR/EN). */
  protected readonly L = (tr: string, en: string) => this.i18n.L(tr, en);

  onSelectSize(n: number): void {
    this.selectedSize.set(n);
  }

  /** Klasik/Zen/Zaman Yarışı — seçili boyutla başlatır. */
  onStartMode(mode: GameMode): void {
    this.game.startMode(mode, this.selectedSize());
  }

  /** Seviye modu (her zaman 4×4). */
  onStartLevel(): void {
    this.game.startLevelMode();
  }
}
