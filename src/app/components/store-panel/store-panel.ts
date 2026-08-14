import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { ThemeService } from '../../services/theme.service';
import { THEMES } from '../../models/theme.model';
import { POWERS, PowerId } from '../../models/power.model';

/**
 * Mağaza paneli (temalar + güçler sekmeleri).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 */
@Component({
  selector: 'app-store-panel',
  standalone: true,
  templateUrl: './store-panel.html',
  styleUrl: './store-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorePanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly themeService = inject(ThemeService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly gold = this.game.gold;
  protected readonly powers = this.game.powers;
  protected readonly theme = this.themeService.theme;
  protected readonly THEMES = THEMES;
  protected readonly POWERS = POWERS;

  /** Aktif mağaza sekmesi. */
  protected readonly storeTab = signal<'themes' | 'powers'>('themes');

  setStoreTab(tab: 'themes' | 'powers'): void {
    this.storeTab.set(tab);
  }

  /** Tema kartı için renkli gradyan (önizleme). */
  protected themeGradient(swatch: [string, string, string]): string {
    return `linear-gradient(135deg, ${swatch[1]}, ${swatch[2]})`;
  }

  /** Bir tema sahip olunuyor mu? */
  protected isThemeOwned(id: string): boolean {
    return this.themeService.isOwned(id);
  }

  /** Temayı seç (sahip olunanlar arasından). */
  onSelectTheme(id: string): void {
    this.themeService.select(id);
  }

  /** Temayı mağazadan satın al. */
  onBuyTheme(id: string): void {
    this.themeService.buyTheme(id);
  }

  /** Bir gücü satın al (yeterli altın varsa). */
  onBuyPower(id: PowerId): void {
    this.game.buyPower(id);
  }

  /** Bir güce yetecek altın var mı? */
  protected canAfford(id: PowerId): boolean {
    const price = POWERS.find((p) => p.id === id)!.price;
    return this.gold() >= price;
  }
}
