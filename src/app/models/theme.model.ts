// ============================================================
//  2048 — Tema kataloğu (mağazadan altınla açılır)
//  Açık/Koyu ücretsiz; diğerleri altınla satın alınır.
//  Her tema, _base.scss'teki [data-theme='<id>'] paletine karşılık gelir.
// ============================================================

export interface ThemeDef {
  id: string;
  name: string;
  /** Altın fiyatı (0 = ücretsiz). */
  price: number;
  /** Önizleme için 3 renk: [arka plan, tahta, vurgu]. */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'light', name: 'Açık', price: 0, swatch: ['#faf8ef', '#bbada0', '#edc22e'] },
  { id: 'dark', name: 'Koyu', price: 0, swatch: ['#1a1917', '#3b3733', '#edc22e'] },
  { id: 'neon', name: 'Neon', price: 200, swatch: ['#0d0221', '#7b2ff7', '#00e5ff'] },
  { id: 'ocean', name: 'Okyanus', price: 300, swatch: ['#0a2540', '#1e88c7', '#48cae4'] },
  { id: 'forest', name: 'Orman', price: 250, swatch: ['#e9f5e1', '#4e8a45', '#8bc34a'] },
  { id: 'sunset', name: 'Gün Batımı', price: 200, swatch: ['#2a1a2e', '#e8623a', '#f9c74f'] },
];

/** Ücretsiz (varsayılan sahip olunan) temalar. */
export const FREE_THEMES = ['light', 'dark'];

export function themeDef(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
