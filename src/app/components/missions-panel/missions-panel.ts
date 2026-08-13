import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { missionDef } from '../../models/mission.model';

/**
 * Görevler paneli (günlük + haftalık görevler, ödül alma).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Panelin açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 */
@Component({
  selector: 'app-missions-panel',
  standalone: true,
  templateUrl: './missions-panel.html',
  styleUrl: './missions-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionsPanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  /** Panel kapatıldığında (arka plana tıklama / Kapat) bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  protected readonly L = (tr: string, en: string) => this.i18n.L(tr, en);

  /** Günlük görevleri tanımlarıyla birleştirir (UI için). */
  protected readonly dailyView = computed(() =>
    this.game
      .dailyMissions()
      .map((m) => ({ ...m, def: missionDef(m.id)! }))
      .filter((m) => m.def),
  );

  /** Haftalık görevleri tanımlarıyla birleştirir. */
  protected readonly weeklyView = computed(() =>
    this.game
      .weeklyMissions()
      .map((m) => ({ ...m, def: missionDef(m.id)! }))
      .filter((m) => m.def),
  );

  protected onClaim(id: string, type: 'daily' | 'weekly'): void {
    this.game.claimMission(id, type);
  }
}
