import { Direction } from '../models/tile.model';

// ============================================================
//  2048 — Dokunmatik kaydırma yön tespiti (saf, test edilebilir)
// ============================================================

/** Bir kaydırmanın hamle sayılması için gereken en az piksel. */
export const SWIPE_THRESHOLD = 30;

/**
 * Parmak hareketinin (dx, dy) yönünü hamleye çevirir.
 * - Eşik altındaki küçük dokunuşlar yok sayılır (null).
 * - Yatay/dikey karar: mutlak değeri büyük olan eksen kazanır.
 * @param dx  bitiş.x - başlangıç.x  (sağ = +)
 * @param dy  bitiş.y - başlangıç.y  (aşağı = +)
 */
export function swipeDirection(
  dx: number,
  dy: number,
  threshold: number = SWIPE_THRESHOLD,
): Direction | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Eşik altındaysa (dokunma/tıklama) hamle yok
  if (Math.max(absX, absY) < threshold) return null;

  if (absX > absY) {
    return dx > 0 ? Direction.Right : Direction.Left;
  }
  return dy > 0 ? Direction.Down : Direction.Up;
}
