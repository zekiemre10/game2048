import { Injectable, computed, inject, signal } from '@angular/core';
import { FREE_THEMES, themeDef } from '../models/theme.model';
import { GameService } from './game.service';

// ============================================================
//  2048 — Tema servisi
//  Açık/Koyu ücretsiz; diğer temalar mağazadan altınla açılır.
//  Seçili tema + sahip olunan temalar localStorage'da saklanır.
// ============================================================

/** Seçili temanın localStorage anahtarı. */
const THEME_KEY = 'game2048.theme';

/** Sahip olunan temaların localStorage anahtarı. */
const OWNED_THEMES_KEY = 'game2048.ownedThemes';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly game = inject(GameService);

  /** Aktif tema id'si. */
  readonly theme = signal<string>(loadTheme());

  /** Sahip olunan tema id'leri (açık/koyu her zaman dahil). */
  readonly ownedThemes = signal<Set<string>>(loadOwnedThemes());

  /** Bir tema sahip olunuyor mu? */
  isOwned(id: string): boolean {
    return this.ownedThemes().has(id);
  }

  constructor() {
    this.applyToDocument(this.theme());
  }

  /** Temayı seçer (yalnızca sahip olunanlar). */
  select(id: string): void {
    if (!this.isOwned(id)) return;
    this.theme.set(id);
    saveTheme(id);
    this.applyToDocument(id);
  }

  /**
   * Temayı altınla satın alır.
   * @returns satın alma başarılıysa true.
   */
  buyTheme(id: string): boolean {
    if (this.isOwned(id)) return false;
    const price = themeDef(id).price;
    if (!this.game.spendGold(price)) return false;

    this.ownedThemes.update((s) => new Set(s).add(id));
    saveOwnedThemes(this.ownedThemes());
    this.select(id); // satın alınca otomatik uygula
    return true;
  }

  /** <html data-theme="..."> — CSS değişkenleri bu attribute'a bağlı. */
  private applyToDocument(id: string): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', id);
  }
}

/** Seçili temayı okur; yoksa sistem tercihine düşer. */
function loadTheme(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) return saved;
    }
    if (
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    /* varsayılana düş */
  }
  return 'light';
}

function saveTheme(id: string): void {
  try {
    localStorage?.setItem(THEME_KEY, id);
  } catch {
    /* yoksay */
  }
}

/** Sahip olunan temaları okur (açık/koyu her zaman dahil). */
function loadOwnedThemes(): Set<string> {
  const owned = new Set<string>(FREE_THEMES);
  try {
    if (typeof localStorage === 'undefined') return owned;
    const raw = localStorage.getItem(OWNED_THEMES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const id of arr) if (typeof id === 'string') owned.add(id);
      }
    }
  } catch {
    /* yoksay */
  }
  return owned;
}

function saveOwnedThemes(owned: Set<string>): void {
  try {
    localStorage?.setItem(OWNED_THEMES_KEY, JSON.stringify([...owned]));
  } catch {
    /* yoksay */
  }
}
