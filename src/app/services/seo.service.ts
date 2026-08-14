import { Injectable, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { I18nService } from './i18n.service';

// ============================================================
//  2048 — SEO / paylaşım meta servisi
//  Aktif DİLE göre sekme başlığını, meta açıklamayı ve Open Graph / Twitter
//  paylaşım etiketlerini çalışma zamanında günceller. Metinler i18n'de
//  (seo.title / seo.description). Statik varsayılanlar (og:image, canonical,
//  hreflang) index.html'dedir — JS çalıştırmayan sosyal tarayıcılar için.
//
//  NOT: İstemci-render SPA olduğundan JS çalıştırmayan tarayıcılar (bazı sosyal
//  kazıyıcılar) index.html'deki VARSAYILAN (tr) etiketleri görür; buradaki
//  güncelleme sekme başlığını + JS çalıştıran kazıyıcıları (Google) kapsar.
// ============================================================

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly i18n = inject(I18nService);

  constructor() {
    // Dil (veya sözlük yüklemesi) değişince tüm meta etiketlerini tazele.
    // effect, i18n.lang() + t() içindeki dict() sinyalini izler → otomatik çalışır.
    effect(() => this.refresh());
  }

  /** Aktif dile göre sekme başlığı + açıklama + OG/Twitter etiketlerini yazar. */
  refresh(): void {
    const lang = this.i18n.lang();
    const title = this.i18n.t('seo.title');
    const desc = this.i18n.t('seo.description');

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: desc });

    // Open Graph (paylaşım önizlemesi)
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: desc });
    this.meta.updateTag({ property: 'og:locale', content: lang === 'en' ? 'en_US' : 'tr_TR' });
    this.meta.updateTag({
      property: 'og:locale:alternate',
      content: lang === 'en' ? 'tr_TR' : 'en_US',
    });

    // Twitter kartı
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: desc });
  }
}
