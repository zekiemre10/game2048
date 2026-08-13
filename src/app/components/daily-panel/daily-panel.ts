import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { DailyService } from '../../services/daily.service';

/**
 * Günlük meydan okuma paneli (günün tahtası + günlük sıralama).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 * Giriş gerektiren durumda `openAuth` ile ana bileşenden hesap paneli açılır.
 */
@Component({
  selector: 'app-daily-panel',
  standalone: true,
  templateUrl: './daily-panel.html',
  styleUrl: './daily-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyPanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly daily = inject(DailyService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Misafirken giriş çağrısına tıklanınca ana bileşenden hesap paneli açılır. */
  readonly openAuth = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly authUser = this.auth.user;
  protected readonly dailyRows = this.daily.rows;
  protected readonly dailyMyRow = this.daily.myRow;
  protected readonly dailyLoading = this.daily.loading;
  protected readonly dailyError = this.daily.error;
  protected readonly dailyPlayers = this.daily.players;
  protected readonly dailyToday = this.daily.today;

  /** Günün tahtasını oyna (panel kapanır, oyun başlar). */
  onPlayDaily(): void {
    this.game.startDaily();
    this.close.emit();
  }

  /** İlk üç sıraya madalya, sonrasına sıra numarası. */
  protected medalFor(rank: number): string {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
  }
}
