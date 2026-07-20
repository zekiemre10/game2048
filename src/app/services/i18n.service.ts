import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Dil servisi (TR / EN)
//  Statik metinler DICT'ten t() ile; model verileri L(tr,en) ile.
//  Tercih localStorage'da saklanır.
// ============================================================

export type Lang = 'tr' | 'en';

const LANG_KEY = 'game2048.lang';

/** Tüm statik arayüz metinleri. */
const DICT: Record<string, { tr: string; en: string }> = {
  // Başlık ekranı
  'start.subtitle': {
    tr: "Taşları birleştir, <strong>2048</strong>'e ulaş!",
    en: 'Merge the tiles, reach <strong>2048</strong>!',
  },
  'start.play': { tr: 'Başla', en: 'Play' },
  'start.levelMode': { tr: '🎯 Seviye Modu', en: '🎯 Level Mode' },
  'start.totalGold': { tr: '💰 Toplam altın:', en: '💰 Total gold:' },
  'start.bestLevel': { tr: '🏅 Ulaşılan en yüksek seviye:', en: '🏅 Highest level reached:' },
  'start.hint': {
    tr: 'Ok tuşlarıyla oyna · Aynı sayıları birleştir',
    en: 'Play with arrow keys · Merge equal numbers',
  },

  // HUD
  'hud.score': { tr: 'SKOR', en: 'SCORE' },
  'hud.best': { tr: 'EN İYİ', en: 'BEST' },
  'hud.time': { tr: 'SÜRE', en: 'TIME' },
  'hud.remaining': { tr: 'KALAN', en: 'LEFT' },
  'hud.moves': { tr: 'HAMLE', en: 'MOVES' },
  'hud.level': { tr: 'Seviye', en: 'Level' },
  'hud.target': { tr: 'Hedef:', en: 'Target:' },

  // Butonlar
  'btn.undo': { tr: '↶ Geri Al', en: '↶ Undo' },
  'btn.newGame': { tr: 'Yeni Oyun', en: 'New Game' },
  'btn.restart': { tr: 'Baştan', en: 'Restart' },
  'btn.close': { tr: 'Kapat', en: 'Close' },

  // Bomba
  'bomb.hint': { tr: '💣 Silmek için bir kareye dokun', en: '💣 Tap a tile to remove it' },
  'bomb.cancel': { tr: 'İptal', en: 'Cancel' },

  // Overlay
  'ov.wonAllTitle': { tr: 'Tebrikler! 🏆', en: 'Congrats! 🏆' },
  'ov.wonAllSub': { tr: 'Tüm seviyeleri bitirdin', en: 'You beat all levels' },
  'ov.wonTitle': { tr: 'Kazandın! 🎉', en: 'You Won! 🎉' },
  'ov.wonSub': { tr: "2048'e ulaştın", en: 'You reached 2048' },
  'ov.levelDoneTitle': { tr: 'Seviye {n} Tamamlandı! 🎉', en: 'Level {n} Complete! 🎉' },
  'ov.levelDoneSub': { tr: 'Hedefe ulaştın ({x})', en: 'Target reached ({x})' },
  'ov.failTitle': { tr: 'Başarısız', en: 'Failed' },
  'ov.timeUp': { tr: 'Süre doldu!', en: "Time's up!" },
  'ov.noMoves': { tr: 'Hamle kalmadı', en: 'No moves left' },
  'ov.gameOver': { tr: 'Oyun Bitti', en: 'Game Over' },
  'ov.score': { tr: 'Skor:', en: 'Score:' },
  'ov.left': { tr: 'kaldı', en: 'left' },
  'ov.movesSuffix': { tr: 'hamle', en: 'moves' },
  'ov.goldWon': { tr: '+{g} altın kazandın!', en: '+{g} gold earned!' },
  'ov.goldAlready': {
    tr: 'Bu seviyenin ödülü zaten alınmıştı',
    en: "This level's reward was already claimed",
  },
  'ov.nextLevel': { tr: 'Sonraki Seviye →', en: 'Next Level →' },
  'ov.retry': { tr: '↻ Tekrar Dene', en: '↻ Try Again' },
  'ov.continue': { tr: 'Devam Et', en: 'Keep Going' },

  // Ayarlar
  'set.title': { tr: '⚙️ Ayarlar', en: '⚙️ Settings' },
  'set.note': {
    tr: 'Ayarların otomatik kaydedilir ve oyunu tekrar açtığında korunur.',
    en: 'Your settings are saved automatically and kept next time.',
  },
  'set.sound': { tr: '🔊 SES', en: '🔊 SOUND' },
  'set.music': { tr: 'Müzik', en: 'Music' },
  'set.musicVol': { tr: 'Müzik sesi', en: 'Music volume' },
  'set.sfxVol': { tr: 'Efekt sesleri', en: 'Sound effects' },
  'set.theme': { tr: '🎨 TEMA', en: '🎨 THEME' },
  'set.moreThemes': { tr: "Daha fazla tema 🛒 Mağaza'da", en: 'More themes in the 🛒 Store' },
  'set.lang': { tr: '🌐 DİL / LANGUAGE', en: '🌐 LANGUAGE / DİL' },
  'set.credit': {
    tr: '🎵 "Calm Mind – Chill Lofi Beat" — FASSounds · Pixabay · Ücretsiz lisans',
    en: '🎵 "Calm Mind – Chill Lofi Beat" — FASSounds · Pixabay · Free license',
  },

  // Mağaza
  'store.title': { tr: '🛒 Mağaza', en: '🛒 Store' },
  'store.note': {
    tr: 'Altınlarını güçlere ve temalara harca.',
    en: 'Spend your gold on powers and themes.',
  },
  'store.tabThemes': { tr: '🎨 Temalar', en: '🎨 Themes' },
  'store.tabPowers': { tr: '⚡ Güçler', en: '⚡ Powers' },
  'store.tabAch': { tr: '🏅 Başarımlar', en: '🏅 Achievements' },
  'store.used': { tr: '✓ Kullanımda', en: '✓ In use' },
  'store.select': { tr: 'Seç', en: 'Select' },
  'store.unlocked': { tr: '✓ Açıldı', en: '✓ Unlocked' },

  // Profil
  'prof.claimDaily': { tr: '🎁 Günlük Ödülü Al', en: '🎁 Claim Daily Reward' },
  'prof.dailyDone': {
    tr: '✓ Günlük ödül alındı — yarın tekrar gel!',
    en: '✓ Daily reward claimed — come back tomorrow!',
  },
  'prof.games': { tr: 'OYUN', en: 'GAMES' },
  'prof.winrate': { tr: 'KAZANMA', en: 'WIN RATE' },
  'prof.bestTile': { tr: 'EN İYİ KARE', en: 'BEST TILE' },
  'prof.streak': { tr: 'SERİ', en: 'STREAK' },
  'prof.bestStreak': { tr: 'EN İYİ SERİ', en: 'BEST STREAK' },
  'prof.totalMoves': { tr: 'TOPLAM HAMLE', en: 'TOTAL MOVES' },
  'prof.seeAch': { tr: '🏅 Başarımları Gör', en: '🏅 View Achievements' },

  // Navigasyon / erişilebilirlik
  'nav.missions': { tr: 'Görevler', en: 'Missions' },
  'nav.store': { tr: 'Mağaza', en: 'Store' },
  'nav.settings': { tr: 'Ayarlar', en: 'Settings' },
  'nav.profile': { tr: 'Profil', en: 'Profile' },
  'prof.nameLabel': { tr: 'Oyuncu adı', en: 'Player name' },
  'hud.totalGold': { tr: 'Toplam altın', en: 'Total gold' },

  // Görevler
  'mis.title': { tr: '🎯 Görevler', en: '🎯 Missions' },
  'mis.note': {
    tr: 'Görevleri tamamla, altın kazan. Günlük her gün, haftalık her hafta yenilenir.',
    en: 'Complete missions, earn gold. Daily resets each day, weekly each week.',
  },
  'mis.daily': { tr: '📅 Günlük', en: '📅 Daily' },
  'mis.weekly': { tr: '🗓️ Haftalık', en: '🗓️ Weekly' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  /** Aktif dil. */
  readonly lang = signal<Lang>(loadLang());

  constructor() {
    this.applyHtmlLang(this.lang());
  }

  /** Statik metin (anahtarla). {n} gibi yer tutucular params ile doldurulur. */
  t(key: string, params?: Record<string, string | number>): string {
    const entry = DICT[key];
    let str = entry ? entry[this.lang()] : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  /** Model verisi için: dile göre TR ya da EN metni seç. */
  L(tr: string, en: string): string {
    return this.lang() === 'en' ? en : tr;
  }

  /** Dili ayarla (kalıcı). */
  set(lang: Lang): void {
    this.lang.set(lang);
    saveLang(lang);
    this.applyHtmlLang(lang);
  }

  private applyHtmlLang(lang: Lang): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }
}

function loadLang(): Lang {
  try {
    const saved = localStorage?.getItem(LANG_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
    // Tarayıcı dili İngilizce ise EN başlat
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) {
      return 'en';
    }
  } catch {
    /* varsayılan */
  }
  return 'tr';
}

function saveLang(lang: Lang): void {
  try {
    localStorage?.setItem(LANG_KEY, lang);
  } catch {
    /* yoksay */
  }
}
