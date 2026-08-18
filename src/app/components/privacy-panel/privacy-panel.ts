import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { I18nService } from '../../services/i18n.service';

/**
 * Gizlilik politikası + veri sorumluluğu (📋). İki dilli (TR/EN) — oyundan
 * erişilebilir (Ayarlar + kayıt ekranı bağlantısı). Metin, kodun GERÇEKTE
 * yaptığıyla birebir tutulur (yönetici yetkileri, saklama süreleri).
 */
@Component({
  selector: 'app-privacy-panel',
  standalone: true,
  templateUrl: './privacy-panel.html',
  styleUrl: './privacy-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPanel {
  private readonly i18n = inject(I18nService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string) => this.i18n.t(key);
  /** Aktif dil TR mi? (metin bloğu seçimi). */
  protected readonly tr = computed(() => this.i18n.lang() === 'tr');
}
