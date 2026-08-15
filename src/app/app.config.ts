import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { I18nService } from './services/i18n.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Aktif dilin sözlüğünü bootstrap ÖNCESİ yükle → ilk boyamada t() senkron.
    provideAppInitializer(() => inject(I18nService).init()),
    // PWA service worker: yalnız üretimde; uygulama kararlı olunca kaydolur
    // (ilk boyamayı geciktirmez). Çevrimdışı kabuk + güncelleme buradan gelir.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
