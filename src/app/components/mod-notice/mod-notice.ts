import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { ModerationService, ModNotice } from '../../services/moderation.service';

/**
 * Moderasyon bildirimi banner'ı: kullanıcıya bir yönetici işlemini (uyarı,
 * susturma, askı…) **sebebiyle** gösterir ve itiraz yolunu hatırlatır.
 * En güncel, kapatılmamış bildirimi gösterir; kullanıcı kapatınca bir daha çıkmaz.
 */
@Component({
  selector: 'app-mod-notice',
  standalone: true,
  templateUrl: './mod-notice.html',
  styleUrl: './mod-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModNoticeBanner {
  private readonly i18n = inject(I18nService);
  private readonly mod = inject(ModerationService);

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly notice = this.mod.latest;

  /** Bildirim başlığı — eylem türüne göre. */
  protected readonly title = computed(() => {
    const n = this.notice();
    if (!n) return '';
    const known = ['warn', 'mute', 'unmute', 'suspend', 'unsuspend'];
    return this.t(known.includes(n.action) ? `mod.notice.${n.action}` : 'mod.notice.generic');
  });

  /** Susturma bitiş zamanı (varsa) yerelleştirilmiş metin. */
  protected readonly untilText = computed(() => {
    const n = this.notice();
    if (!n || !n.until) return '';
    const d = new Date(n.until * 1000);
    return this.t('mod.notice.until', { date: d.toLocaleString() });
  });

  protected reason(n: ModNotice): string {
    return n.reason?.trim() || this.t('mod.notice.noReason');
  }

  dismiss(): void {
    const n = this.notice();
    if (n) this.mod.dismiss(n.id);
  }
}
