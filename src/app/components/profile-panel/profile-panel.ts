import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AVATARS, GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { BOT_CHARACTERS, BOT_CHARACTER_IDS } from '../../logic/ai';

/**
 * Profil paneli (ünvan + avatar + 7 günlük ödül takvimi + istatistikler).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 * Misafirken giriş çağrısı `openAuth` ile ana bileşenden hesap panelini açar.
 */
@Component({
  selector: 'app-profile-panel',
  standalone: true,
  templateUrl: './profile-panel.html',
  styleUrl: './profile-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Misafirken giriş çağrısı → ana bileşen hesap panelini açar. */
  readonly openAuth = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly authUser = this.auth.user;
  protected readonly avatar = this.game.avatar;
  protected readonly AVATARS = AVATARS;
  protected readonly rankInfo = this.game.rankInfo;
  protected readonly championships = this.game.championships;
  protected readonly rewardCalendar = this.game.rewardCalendar;
  protected readonly rewardCycleDay = this.game.rewardCycleDay;
  protected readonly claimedReward = this.game.claimedReward;
  protected readonly canClaimDaily = this.game.canClaimDaily;
  protected readonly bestScore = this.game.bestScore;
  protected readonly bestTile = this.game.bestTile;
  protected readonly bestLevel = this.game.bestLevel;
  protected readonly gamesPlayed = this.game.gamesPlayed;
  protected readonly winRate = this.game.winRate;
  protected readonly totalMoves = this.game.totalMoves;
  protected readonly currentStreak = this.game.currentStreak;
  protected readonly bestStreak = this.game.bestStreak;
  protected readonly totalGoldEarned = this.game.totalGoldEarned;

  /**
   * Karakter bazlı yarış galibiyeti: yalnızca EN AZ BİR kez karşılaşılan
   * karakterler (avatar + ad + "yenildi/karşılaşıldı"). Boşsa bölüm gizlenir.
   */
  protected readonly characterStats = computed(() => {
    const wins = this.game.characterWins();
    return BOT_CHARACTER_IDS.map((id) => ({
      id,
      avatar: BOT_CHARACTERS[id].avatar,
      faced: wins[id]?.faced ?? 0,
      beaten: wins[id]?.beaten ?? 0,
    })).filter((c) => c.faced > 0);
  });

  /** Avatar seçici açık mı? */
  protected readonly avatarPickerOpen = signal(false);

  /**
   * Görünen oyuncu adı: giriş yapıldıysa KAYIT NICK'İ (değiştirilemez),
   * misafirse dile göre yerelleştirilmiş varsayılan ("Oyuncu"/"Player").
   */
  protected readonly displayName = computed(() => {
    const u = this.authUser();
    if (u) return u.username;
    return this.i18n.t('common.player');
  });

  /** Avatar seçiciyi aç/kapat. */
  onToggleAvatarPicker(): void {
    this.avatarPickerOpen.update((v) => !v);
  }

  /** Avatarı seç ve seçiciyi kapat. */
  onSelectAvatar(a: string): void {
    this.game.setAvatar(a);
    this.avatarPickerOpen.set(false);
  }

  /** Günlük ödülü al. */
  onClaimDaily(): void {
    this.game.claimDailyReward();
  }
}
