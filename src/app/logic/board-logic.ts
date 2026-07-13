import { BOARD_SIZE, Direction, Tile } from '../models/tile.model';

// ============================================================
//  2048 — Saf hamle mantığı (framework'ten bağımsız, test edilebilir)
//
//  Temel fikir:
//   1) Tek bir "satırı" (push kenarından içeri doğru sıralı kareler)
//      sıkıştırıp birleştiren SAF fonksiyon: slideLine().
//   2) 4 yön, bu tek fonksiyona indirgenir: her yön için kareler
//      "itilen kenardan uzaklığa göre" sıralanır (döndürme/ters çevirme
//      yerine sıralama + koordinat eşleme).
//
//  Kural: bir hamlede her kare EN FAZLA BİR KEZ birleşir
//         (zincirleme birleşme yok → 2 2 4 => 4 4).
// ============================================================

/** slideLine'a giren minimal kare bilgisi. */
interface LineTile {
  id: number;
  value: number;
}

/** slideLine'dan çıkan yerleşmiş kare. */
interface PlacedTile {
  id: number;
  value: number;
  /** İtilen kenardan itibaren 0 tabanlı konum. */
  index: number;
  /** Bu hamlede birleşerek oluştu mu? */
  merged: boolean;
}

/** Tüm tahtaya uygulanan hamlenin sonucu. */
export interface MoveResult {
  /** Yeni kare listesi (id'ler korunur; birleşenlerde biri kaybolur). */
  tiles: Tile[];
  /** Bu hamlede kazanılan puan (birleşen karelerin toplam yeni değeri). */
  gained: number;
  /** Hamle ızgarayı değiştirdi mi? (false → geçersiz hamle) */
  moved: boolean;
}

/**
 * Tek bir satırı itilen kenara (index 0) doğru sıkıştırır ve birleştirir.
 * `line`, itilen kenardan içeri doğru SIRALI kareleri içerir.
 * Her kare en fazla bir kez birleşir.
 */
export function slideLine(line: LineTile[]): {
  placed: PlacedTile[];
  gained: number;
} {
  const placed: PlacedTile[] = [];
  let gained = 0;

  for (const tile of line) {
    const last = placed[placed.length - 1];
    // Bir önceki yerleşen kareyle aynı değerdeyse ve o kare bu hamlede
    // henüz birleşmediyse → birleş (survivor önceki karenin id'sini korur).
    if (last && !last.merged && last.value === tile.value) {
      last.value *= 2;
      last.merged = true;
      gained += last.value;
    } else {
      placed.push({
        id: tile.id,
        value: tile.value,
        index: placed.length,
        merged: false,
      });
    }
  }

  return { placed, gained };
}

/**
 * Verilen yöne tüm tahtayı kaydırır + birleştirir.
 * Saf fonksiyon: girdiyi değiştirmez, yeni bir sonuç döndürür.
 */
export function applyMove(
  tiles: Tile[],
  direction: Direction,
  size: number = BOARD_SIZE,
): MoveResult {
  const horizontal =
    direction === Direction.Left || direction === Direction.Right;
  // İtilen kenar index 0 mı? (sol/yukarı → evet)
  const towardStart =
    direction === Direction.Left || direction === Direction.Up;

  const result: Tile[] = [];
  let gained = 0;

  for (let line = 0; line < size; line++) {
    // Bu satır/sütundaki kareler
    const inLine = tiles.filter(
      (t) => (horizontal ? t.row : t.col) === line,
    );

    // İtilen kenardan uzaklığa göre sırala
    inLine.sort((a, b) => {
      const pa = horizontal ? a.col : a.row;
      const pb = horizontal ? b.col : b.row;
      return towardStart ? pa - pb : pb - pa;
    });

    const { placed, gained: lineGain } = slideLine(inLine);
    gained += lineGain;

    for (const p of placed) {
      // İtilen kenardan uzaklığı gerçek satır/sütuna çevir
      const pos = towardStart ? p.index : size - 1 - p.index;
      const row = horizontal ? line : pos;
      const col = horizontal ? pos : line;
      result.push({ id: p.id, value: p.value, row, col, merged: p.merged });
    }
  }

  return { tiles: result, gained, moved: gridChanged(tiles, result, size) };
}

/** Kare listesini değer ızgarasına (2B sayı matrisi) çevirir. */
export function toValueGrid(tiles: Tile[], size: number = BOARD_SIZE): number[][] {
  const grid: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0),
  );
  for (const t of tiles) {
    grid[t.row][t.col] = t.value;
  }
  return grid;
}

/** İki tahtanın değer olarak farklı olup olmadığını kontrol eder. */
function gridChanged(before: Tile[], after: Tile[], size: number): boolean {
  const a = toValueGrid(before, size);
  const b = toValueGrid(after, size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (a[r][c] !== b[r][c]) return true;
    }
  }
  return false;
}

/**
 * Hiç hamle yapılamıyor mu? (tahta dolu ve hiçbir yönde birleşme yok)
 * Oyun sonu tespiti için — sonraki adımda kullanılacak.
 */
export function hasAnyMove(tiles: Tile[], size: number = BOARD_SIZE): boolean {
  if (tiles.length < size * size) return true; // boş hücre var
  return [Direction.Left, Direction.Right, Direction.Up, Direction.Down].some(
    (dir) => applyMove(tiles, dir, size).moved,
  );
}
