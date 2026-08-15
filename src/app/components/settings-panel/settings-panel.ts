import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService, Lang } from '../../services/i18n.service';
import { ThemeService } from '../../services/theme.service';
import { AudioService } from '../../services/audio.service';
import { SfxService } from '../../services/sfx.service';
import { AuthService } from '../../services/auth.service';
import { THEMES } from '../../models/theme.model';

/**
 * Ayarlar paneli (ses, dil, YZ asistanı, tema, rehber, hesap).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close` ile bildirilir.
 * `showTutorial` rehberi (ana bileşende) yeniden açar; `logout` çıkışı yaptırır.
 * Tüm hesap erişimi burada toplanır: misafire `openAuth` (giriş/kayıt), girişliye
 * çıkış + `accountDeleted` (şifre onaylı kalıcı silme).
 */
@Component({
  selector: 'app-settings-panel',
  standalone: true,
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPanel {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly themeService = inject(ThemeService);
  private readonly audio = inject(AudioService);
  private readonly sfx = inject(SfxService);
  private readonly auth = inject(AuthService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Rehberi yeniden aç (ana bileşen tutorial'ı yönetir). */
  readonly showTutorial = output<void>();
  /** Çıkış yap (ana bileşen sohbet/oda/arkadaş durumunu da temizler). */
  readonly logout = output<void>();
  /** Misafirken giriş/kayıt paneli aç (giriş erişimi artık profilde değil, burada). */
  readonly openAuth = output<void>();
  /** Hesap KALICI silindi → ana bileşen açık sohbet/oda/arkadaş durumunu temizler. */
  readonly accountDeleted = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  protected readonly lang = this.i18n.lang;

  protected readonly musicOn = this.audio.musicOn;
  protected readonly assistantOn = this.game.assistantOn;
  protected readonly theme = this.themeService.theme;
  protected readonly authUser = this.auth.user;
  protected readonly THEMES = THEMES;

  /** Müzik ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly volumePercent = computed(() => Math.round(this.audio.volume() * 100));

  /** Efekt ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly sfxPercent = computed(() => Math.round(this.sfx.sfxVolume() * 100));

  /** Müziği aç/kapat. */
  onToggleMusic(): void {
    this.audio.toggleMusic();
  }

  /** Müzik ses seviyesi kaydırıcısı değişti (0-100 → 0..1). */
  onVolumeInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.audio.setVolume(value / 100);
  }

  /** Efekt ses seviyesi kaydırıcısı değişti (0-100 → 0..1). */
  onSfxInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.sfx.setVolume(value / 100);
    this.sfx.playMove(); // anlık önizleme: kaydırınca duyulsun
  }

  /** Dili ayarla. */
  onSetLang(lang: Lang): void {
    this.i18n.set(lang);
  }

  /** Asistanı aç/kapat (kalıcı). */
  onToggleAssistant(): void {
    this.game.setAssistant(!this.assistantOn());
  }

  /** Bir tema sahip olunuyor mu? */
  protected isThemeOwned(id: string): boolean {
    return this.themeService.isOwned(id);
  }

  /** Temayı seç (sahip olunanlar arasından). */
  onSelectTheme(id: string): void {
    this.themeService.select(id);
  }

  // --- Hesabı sil (şifre onaylı, kalıcı) ----------------------

  /** Silme onay bölümü açık mı (butona basınca açılır). */
  protected readonly deleteOpen = signal(false);
  /** Onay için girilen şifre. */
  protected readonly delPassword = signal('');
  /** Silme sürüyor mu (buton kilidi). */
  protected readonly delBusy = signal(false);
  /** Son silme hatası (yerelleştirilmiş) — yoksa boş. */
  protected readonly delError = signal('');

  /** Silme onayını aç. */
  onOpenDelete(): void {
    this.delPassword.set('');
    this.delError.set('');
    this.deleteOpen.set(true);
  }

  /** Silmekten vazgeç. */
  onCancelDelete(): void {
    this.deleteOpen.set(false);
    this.delPassword.set('');
    this.delError.set('');
  }

  /** Şifre kutusu değişti. */
  onDelPasswordInput(event: Event): void {
    this.delPassword.set((event.target as HTMLInputElement).value);
    if (this.delError()) this.delError.set('');
  }

  /** Hesabı kalıcı sil (şifre onaylı). Başarılıysa ana bileşene bildir. */
  async onConfirmDelete(): Promise<void> {
    const pw = this.delPassword();
    if (!pw || this.delBusy()) return;
    this.delBusy.set(true);
    this.delError.set('');
    const res = await this.auth.deleteAccount(pw);
    this.delBusy.set(false);
    if (res.ok) {
      this.deleteOpen.set(false);
      this.accountDeleted.emit();
      return;
    }
    // Hata kodu → yerelleştirilmiş mesaj (sunucunun serbest metni değil).
    const map: Record<string, string> = {
      'wrong-password': 'set.deleteErrWrongPw',
      session: 'set.deleteErrSession',
      network: 'set.deleteErrNetwork',
    };
    this.delError.set(this.t(map[res.error ?? 'error'] ?? 'set.deleteErrGeneric'));
  }
}
