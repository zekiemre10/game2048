import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { SfxService } from '../../services/sfx.service';
import { LeaderScope, LeaderboardService } from '../../services/leaderboard.service';

/**
 * Skor tablosu paneli (aylık / tüm zamanlar / arkadaşlar + ay sonu ödülü).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 * `openAuth` ile hesap paneli, `celebrate` ile (ödül alınınca) konfeti tetiklenir.
 */
@Component({
  selector: 'app-leaderboard-panel',
  standalone: true,
  templateUrl: './leaderboard-panel.html',
  styleUrl: './leaderboard-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaderboardPanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly sfx = inject(SfxService);
  private readonly leaderboard = inject(LeaderboardService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Misafirken giriş çağrısı → ana bileşen hesap panelini açar. */
  readonly openAuth = output<void>();
  /** Ödül alınınca ana bileşen konfeti patlatır. */
  readonly celebrate = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly authUser = this.auth.user;
  protected readonly lbRows = this.leaderboard.rows;
  protected readonly lbMyRow = this.leaderboard.myRow;
  protected readonly lbLoading = this.leaderboard.loading;
  protected readonly lbScope = this.leaderboard.scope;
  protected readonly lbError = this.leaderboard.error;
  protected readonly lbPrize = this.leaderboard.prize;
  protected readonly lbMonth = this.leaderboard.month;

  /** Ödül alınıyor mu (çift tıklamayı engeller). */
  protected readonly claimingPrize = signal(false);

  /** Kendi satırım listede görünüyor mu? (yoksa ayrıca gösterilir) */
  protected readonly lbInTop = computed(() => {
    const id = this.authUser()?.id;
    return id !== undefined && this.lbRows().some((r) => r.id === id);
  });

  onLeaderboardScope(scope: LeaderScope): void {
    void this.leaderboard.load(scope);
  }

  /**
   * Ay sonu şampiyonluk ödülünü al: sunucu "alındı" işaretler, altın ve
   * güçler burada envantere eklenir (sonra buluta senkronlanır).
   */
  async onClaimPrize(): Promise<void> {
    if (this.claimingPrize()) return;
    this.claimingPrize.set(true);
    try {
      const prize = await this.leaderboard.claimPrize();
      if (!prize) return;
      this.game.grantChampionPrize(prize.gold, prize.powers);
      this.celebrate.emit();
      this.sfx.playFanfare();
    } finally {
      this.claimingPrize.set(false);
    }
  }

  /** Ay bitene kaç gün kaldı (ödülün ne zaman geleceğini göstermek için). */
  protected daysLeftInMonth(): number {
    const now = new Date();
    // Ayın son gününü UTC'de bul (sunucu ay anahtarı UTC)
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.round((end - today) / 86400000));
  }

  /** `YYYY-MM` → "Temmuz 2026" gibi okunur ay adı. */
  protected monthLabel(key: string): string {
    if (!key) return '';
    const [y, m] = key.split('-').map(Number);
    const names =
      this.i18n.lang() === 'en'
        ? [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ]
        : [
            'Ocak',
            'Şubat',
            'Mart',
            'Nisan',
            'Mayıs',
            'Haziran',
            'Temmuz',
            'Ağustos',
            'Eylül',
            'Ekim',
            'Kasım',
            'Aralık',
          ];
    return `${names[(m || 1) - 1]} ${y}`;
  }

  /** İlk üç sıraya madalya, sonrasına sıra numarası. */
  protected medalFor(rank: number): string {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
  }
}
