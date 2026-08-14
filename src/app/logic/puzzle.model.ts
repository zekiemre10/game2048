/**
 * Bulmaca modeli — YZ üretimli, tam-arama doğrulamalı "bu pozisyonu kurtar"
 * görevleri. Bulmacalar DETERMİNİSTİKtir (taş üretimi yok): başlangıç ızgarası
 * sabittir, hamle sonrası yeni taş gelmez → "asgari çözüm hamlesi" iyi tanımlı
 * ve çözüm garanti edilir. Veri scripts/gen-puzzles.mjs ile DERLEME ZAMANINDA
 * üretilir (puzzles.data.ts); çalışma zamanında üretim YOKTUR.
 */

/** Bulmaca türü. */
export type PuzzleType =
  | 'tile' // "N hamlede T karesini yap"
  | 'score' // "N hamlede P puana ulaş"
  | 'clear'; // "N hamlede tahtayı aç: E boş hücre" (tıkanmış tahtayı kurtar)

export interface Puzzle {
  /** Benzersiz kimlik ("p001"). */
  id: string;
  /** Tür (hedef anlamını belirler). */
  type: PuzzleType;
  /** Zorluk bölümü (1'den artan). */
  section: number;
  /** Başlangıç ızgarası (4×4, 0 = boş). */
  grid: number[][];
  /** Hedef: tile → kare değeri · score → puan · clear → boş hücre sayısı. */
  target: number;
  /** Motorla doğrulanmış ASGARİ çözüm hamlesi (mükemmel derece). */
  minMoves: number;
  /** İzin verilen en fazla hamle (minMoves + küçük tolerans). */
  moveBudget: number;
  /** Asgari çözümün hamle dizisi ("ULDR") — ipucu bundan verilir. */
  solution: string;
}
