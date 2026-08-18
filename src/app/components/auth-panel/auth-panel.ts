import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';

/**
 * Hesap paneli (giriş / kayıt modalı).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Panel her açılışta yeniden oluştuğundan form alanları kendiliğinden sıfırlanır.
 * Kapatma `close`, ana ekrana dönüş `goHome` ile ana bileşene bildirilir.
 */
@Component({
  selector: 'app-auth-panel',
  standalone: true,
  templateUrl: './auth-panel.html',
  styleUrl: './auth-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPanel {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Ana ekrana dön (ana bileşen paneller + odayı da temizler). */
  readonly goHome = output<void>();
  /** Gizlilik politikası panelini aç (kayıt onayı bağlantısı). */
  readonly openPrivacy = output<void>();

  /** Gizlilik politikası onayı (kayıtta zorunlu). */
  protected readonly consent = signal(false);
  onConsentChange(event: Event): void {
    this.consent.set((event.target as HTMLInputElement).checked);
  }

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  /** İşlem sürüyor mu? */
  protected readonly authBusy = this.auth.busy;
  /** Panel modu: giriş mi kayıt mı? */
  protected readonly authTab = signal<'login' | 'register'>('login');
  /** Form alanları. */
  protected readonly authName = signal('');
  protected readonly authEmail = signal('');
  protected readonly authPass = signal('');
  /** Hata mesajı anahtarı (auth.err.*), yoksa ''. */
  protected readonly authError = signal('');
  /** Askı ayrıntısı (sebep + bitiş/kalıcı), yoksa ''. */
  protected readonly authErrorDetail = signal('');

  /** Giriş/kayıt sekmesini değiştir. */
  setAuthTab(tab: 'login' | 'register'): void {
    this.authTab.set(tab);
    this.authError.set('');
    this.authErrorDetail.set('');
  }

  onAuthNameInput(event: Event): void {
    this.authName.set((event.target as HTMLInputElement).value);
  }

  onAuthEmailInput(event: Event): void {
    this.authEmail.set((event.target as HTMLInputElement).value);
  }

  onAuthPassInput(event: Event): void {
    this.authPass.set((event.target as HTMLInputElement).value);
  }

  /** Formu gönder (moda göre giriş ya da kayıt). */
  async onAuthSubmit(): Promise<void> {
    if (this.authBusy()) return;
    this.authError.set('');
    this.authErrorDetail.set('');
    const name = this.authName().trim();
    const pass = this.authPass();
    const result =
      this.authTab() === 'register'
        ? await this.auth.register(name, pass, this.authEmail().trim())
        : await this.auth.login(name, pass);
    if (result.ok) {
      this.authPass.set('');
      this.authEmail.set('');
      this.close.emit();
    } else {
      this.authError.set(`auth.err.${result.error}`);
      // Askıda: kullanıcıya SEBEBİYLE ve (varsa) bitişiyle anlamlı mesaj göster.
      if (result.error === 'suspended') {
        const parts: string[] = [];
        if (result.reason) parts.push(result.reason);
        parts.push(
          result.until
            ? this.t('auth.err.suspendedUntil', {
                date: new Date(result.until * 1000).toLocaleString(),
              })
            : this.t('auth.err.suspendedPermanent'),
        );
        this.authErrorDetail.set(parts.join(' · '));
      }
    }
  }
}
