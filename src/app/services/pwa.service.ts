import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** `beforeinstallprompt` olayının (standart lib'de yok) küçük tipi. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA durumu: çevrimiçi/çevrimdışı, "ana ekrana ekle" uygunluğu ve yeni sürüm
 * bildirimi. Service worker kaydı app.config'te (provideServiceWorker); bu servis
 * yalnız DURUMU tutar + kullanıcı eylemlerini (kur / güncelle) yürütür.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly swUpdate = inject(SwUpdate);

  /** Çevrimiçi mi? (navigator.onLine + online/offline olayları). */
  readonly online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

  /** "Ana ekrana ekle" istemi hazır mı? (beforeinstallprompt yakalandı). */
  readonly installable = signal<boolean>(false);

  /** Yeni sürüm indirildi, aktive edilmeyi bekliyor. */
  readonly updateReady = signal<boolean>(false);

  private deferredPrompt: InstallPromptEvent | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.online.set(true));
      window.addEventListener('offline', () => this.online.set(false));
      window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault(); // tarayıcının kendi mini-çubuğunu engelle → biz uygun anda göstereceğiz
        this.deferredPrompt = e as InstallPromptEvent;
        this.installable.set(true);
      });
      window.addEventListener('appinstalled', () => {
        this.installable.set(false);
        this.deferredPrompt = null;
      });
    }
    // Yeni sürüm hazır olunca bildir (SwUpdate yalnız üretimde etkin).
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((e) => {
        if (e.type === 'VERSION_READY') this.updateReady.set(true);
      });
    }
  }

  /** "Ana ekrana ekle" istemini göster (kullanıcı butona tıklayınca). */
  async promptInstall(): Promise<void> {
    const p = this.deferredPrompt;
    if (!p) return;
    this.deferredPrompt = null;
    this.installable.set(false); // istem bir kez kullanılır
    try {
      await p.prompt();
      await p.userChoice;
    } catch {
      /* yoksay */
    }
  }

  /** Yeni sürümü aktive et + sayfayı yenile. */
  async applyUpdate(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
    } catch {
      /* yoksay */
    }
    if (typeof location !== 'undefined') location.reload();
  }
}
