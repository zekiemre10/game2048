import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Dil servisi (TR / EN, büyümeye hazır)
//
//  TÜM çeviri metinleri dil başına AYRI JSON dosyalarında toplanır
//  (src/app/i18n/<lang>.json). Aktif dilin dosyası TEMBEL yüklenir (dynamic
//  import → ayrı chunk); diğer diller ancak geçiş yapılınca iner. Anahtar aktif
//  dilde yoksa VARSAYILAN dile (tr) düşer, o da yoksa anahtarın kendisi döner.
//
//  Yeni dil eklemek: (1) src/app/i18n/<lang>.json ekle (tüm anahtarlar),
//  (2) LANGS + LOADERS'a satır ekle, (3) node scripts/check-i18n.mjs ile doğrula.
//  Ayrıntı: src/app/i18n/README.md.
// ============================================================

export type Lang = 'tr' | 'en';

/** Desteklenen diller (UI dil seçici + kontrol betiği bunu kullanır). */
export const LANGS: readonly Lang[] = ['tr', 'en'];

/** Varsayılan dil — anahtar aktif dilde yoksa buna düşülür. */
const DEFAULT_LANG: Lang = 'tr';

const LANG_KEY = 'game2048.lang';

type Dict = Record<string, string>;

/** Dil başına TEMBEL yükleyici (dynamic import → ayrı chunk, kod bölme). */
const LOADERS: Record<Lang, () => Promise<Dict>> = {
  tr: () => import('../i18n/tr.json').then((m) => m.default as Dict),
  en: () => import('../i18n/en.json').then((m) => m.default as Dict),
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  /** Aktif dil. */
  readonly lang = signal<Lang>(loadLang());

  /** Aktif dilin sözlüğü (yüklendikçe güncellenir → şablonlar yeniden çizilir). */
  private readonly dict = signal<Dict>({});

  /** Varsayılan dilin sözlüğü (eksik anahtar yedeği). */
  private fallback: Dict = {};

  /** Yüklenen dil sözlükleri önbelleği (geçiş anlık olsun). */
  private readonly cache = new Map<Lang, Dict>();

  /** Aktif dilin en son yükleme sözü (init + set izler; ready() bunu döndürür). */
  private lastLoad: Promise<void> = Promise.resolve();

  constructor() {
    this.applyHtmlLang(this.lang());
  }

  /**
   * Uygulama başlarken çağrılır (APP_INITIALIZER, bootstrap ÖNCESİ): aktif dili
   * (ve gerekiyorsa yedek dili) yükler → ilk boyamada t() SENKRON ve doğru olur.
   */
  init(): Promise<void> {
    this.lastLoad = this.use(this.lang());
    return this.lastLoad;
  }

  /** Aktif dilin sözlüğü yüklendiğinde çözülür (kritik akış + test için). */
  ready(): Promise<void> {
    return this.lastLoad;
  }

  /** Bir dilin sözlüğünü önbellekli getirir (tembel yükleme). */
  private async fetchDict(lang: Lang): Promise<Dict> {
    const cached = this.cache.get(lang);
    if (cached) return cached;
    const d = await LOADERS[lang]();
    this.cache.set(lang, d);
    return d;
  }

  /** Aktif dili yükleyip uygular; yedek = varsayılan dil (farklıysa o da yüklenir). */
  private async use(lang: Lang): Promise<void> {
    const [active, fb] = await Promise.all([
      this.fetchDict(lang),
      lang === DEFAULT_LANG ? Promise.resolve(null) : this.fetchDict(DEFAULT_LANG),
    ]);
    this.fallback = fb ?? active;
    this.dict.set(active);
  }

  /** Statik metin (anahtarla). {n} gibi yer tutucular params ile doldurulur. */
  t(key: string, params?: Record<string, string | number>): string {
    // Aktif dil → yoksa varsayılan dil → yoksa anahtarın kendisi.
    let str = this.dict()[key] ?? this.fallback[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  /** Dili ayarla (kalıcı). Sözlük önbellekliyse geçiş anlıktır. */
  set(lang: Lang): void {
    this.lang.set(lang);
    saveLang(lang);
    this.applyHtmlLang(lang);
    syncUrlLang(lang); // paylaşılan link doğru dilde açılsın (?lang=)
    this.lastLoad = this.use(lang);
  }

  private applyHtmlLang(lang: Lang): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }
}

function loadLang(): Lang {
  try {
    // 1) URL ?lang= — paylaşılan link doğru dilde açılsın (kayıtlı tercihi ezer).
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('lang');
      if (q === 'tr' || q === 'en') return q;
    }
    // 2) Kayıtlı tercih.
    const saved = localStorage?.getItem(LANG_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
    // 3) Tarayıcı dili İngilizce ise EN başlat.
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) {
      return 'en';
    }
  } catch {
    /* varsayılan */
  }
  return DEFAULT_LANG;
}

/** Aktif dili URL'de ?lang= olarak yansıtır (paylaşım için; sayfa yenilenmez). */
function syncUrlLang(lang: Lang): void {
  try {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const url = new URL(location.href);
    if (url.searchParams.get('lang') === lang) return;
    url.searchParams.set('lang', lang);
    history.replaceState(history.state, '', url.toString());
  } catch {
    /* yoksay */
  }
}

function saveLang(lang: Lang): void {
  try {
    localStorage?.setItem(LANG_KEY, lang);
  } catch {
    /* yoksay */
  }
}
