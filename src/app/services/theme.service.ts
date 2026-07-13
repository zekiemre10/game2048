import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Tema servisi (açık / koyu)
//  Tercih localStorage'da saklanır. Kayıt yoksa işletim sisteminin
//  tercihi (prefers-color-scheme) kullanılır.
// ============================================================

export type Theme = 'light' | 'dark';

/** Tema tercihinin localStorage anahtarı. */
const THEME_KEY = 'game2048.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Aktif tema. */
  readonly theme = signal<Theme>(loadTheme());

  constructor() {
    this.applyToDocument(this.theme());
  }

  /** Açık ↔ koyu arasında geçiş yapar ve tercihi kalıcı kaydeder. */
  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.set(next);
  }

  /** Temayı doğrudan ayarlar. */
  set(theme: Theme): void {
    this.theme.set(theme);
    saveTheme(theme);
    this.applyToDocument(theme);
  }

  /** <html data-theme="..."> — CSS değişkenleri bu attribute'a bağlı. */
  private applyToDocument(theme: Theme): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Kayıtlı tercihi okur; yoksa sistem tercihine düşer. */
function loadTheme(): Theme {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    }
    // Kayıt yok → işletim sistemi tercihi
    if (
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    // Depolama/matchMedia kullanılamıyorsa varsayılana düş
  }
  return 'light';
}

/** Tercihi kalıcı kaydeder (hata olursa sessizce geçer). */
function saveTheme(theme: Theme): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Gizli mod / kota → oyunu bozma
  }
}
