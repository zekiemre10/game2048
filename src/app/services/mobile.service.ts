import { inject, Injectable, NgZone } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Mobil (Capacitor) entegrasyonu: açılış ekranını gizle, durum çubuğu, Android
 * donanım GERİ tuşu. Yalnız yerel platformda çalışır (web'de no-op) → web
 * dağıtımı bu değişikliklerden ETKİLENMEZ.
 *
 * Geri tuşu Capacitor callback'i Angular bölgesi DIŞINDA gelir → sinyal
 * güncellemeleri değişiklik denetimini tetiklemeyebilir; bu yüzden handler
 * `NgZone.run` içinde koşturulur.
 */
@Injectable({ providedIn: 'root' })
export class MobileService {
  private readonly zone = inject(NgZone);
  readonly isNative = Capacitor.isNativePlatform();

  /** app.ts çağırır: GERİ tuşu davranışını bağlar + açılış kurulumunu yapar. */
  async init(onBack: () => void): Promise<void> {
    if (!this.isNative) return;
    App.addListener('backButton', () => this.zone.run(() => onBack()));
    try {
      await StatusBar.setStyle({ style: Style.Dark }); // açık zemin → koyu ikon
    } catch {
      /* status bar yoksa geç */
    }
    try {
      await SplashScreen.hide();
    } catch {
      /* splash yoksa geç */
    }
  }

  /** Uygulamadan çık (ana ekranda GERİ). */
  async exitApp(): Promise<void> {
    if (!this.isNative) return;
    try {
      await App.exitApp();
    } catch {
      /* geç */
    }
  }
}
