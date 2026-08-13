import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { ACHIEVEMENTS } from '../../models/achievement.model';

/**
 * Başarımlar paneli (ana ekrandaki şeritten açılır).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 */
@Component({
  selector: 'app-achievements-panel',
  standalone: true,
  templateUrl: './achievements-panel.html',
  styleUrl: './achievements-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AchievementsPanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  /** Panel kapatıldığında (arka plana tıklama / Kapat) bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  protected readonly L = (tr: string, en: string) => this.i18n.L(tr, en);

  protected readonly ACHIEVEMENTS = ACHIEVEMENTS;
  protected readonly achTotalCount = ACHIEVEMENTS.length;

  private readonly unlockedAchievements = this.game.unlockedAchievements;

  /** Açılan başarım sayısı. */
  protected readonly achUnlockedCount = computed(() => this.unlockedAchievements().size);

  /** Başarım açık mı? */
  protected isAchievementUnlocked(id: string): boolean {
    return this.unlockedAchievements().has(id);
  }

  /** Bir başarımın ilerlemesi (kilitliyse çubuk çizmek için). */
  protected achProgress(id: string): { current: number; target: number } {
    return this.game.achievementProgress(id);
  }

  /** Başarım ilerlemesinin yüzdesi (0-100). */
  protected achPercent(id: string): number {
    const p = this.game.achievementProgress(id);
    return p.target > 0 ? Math.min(100, (p.current / p.target) * 100) : 0;
  }
}
