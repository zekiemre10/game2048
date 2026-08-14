import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { I18nService } from './services/i18n.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Aktif dilin sözlüğünü bootstrap ÖNCESİ yükle → ilk boyamada t() senkron.
    provideAppInitializer(() => inject(I18nService).init()),
  ],
};
