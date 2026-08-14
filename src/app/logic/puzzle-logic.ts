import { Direction } from '../models/tile.model';
import { ValueGrid, simulateMove } from './ai';
import { Puzzle } from './puzzle.model';

// Bulmaca çalışma-zamanı mantığı — SAF fonksiyonlar. Bulmaca ÜRETİMİ derleme
// zamanındadır (scripts/gen-puzzles.mjs); buradaki arama yalnızca hedef kontrolü
// ve İPUCU (çözme) içindir — üretim değil, çalışma zamanında uygundur.

const DIRS: Direction[] = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];

const maxTileOf = (g: ValueGrid): number => {
  let m = 0;
  for (const row of g) for (const v of row) if (v > m) m = v;
  return m;
};
const emptyCountOf = (g: ValueGrid): number => {
  let n = 0;
  for (const row of g) for (const v of row) if (v === 0) n++;
  return n;
};

/** Bulmaca hedefi sağlandı mı? (tür bazında: kare / boş hücre / skor). */
export function puzzleGoalReached(puzzle: Puzzle, grid: ValueGrid, score: number): boolean {
  switch (puzzle.type) {
    case 'tile':
      return maxTileOf(grid) >= puzzle.target;
    case 'clear':
      return emptyCountOf(grid) >= puzzle.target;
    case 'score':
      return score >= puzzle.target;
  }
}

const sig = (g: ValueGrid): string => g.map((r) => r.join(',')).join('|');

interface HintNode {
  grid: ValueGrid;
  score: number;
  first: Direction | null;
}

/**
 * İpucu: mevcut tahtadan hedefe ulaştıran EN KISA hamle dizisinin İLK hamlesi
 * (BFS, taş üretimi yok — bulmaca deterministik). Kalan hamleye sığmıyorsa null.
 * Oyuncu optimal yoldan sapsa bile mevcut tahtadan yeniden çözer → hep geçerli.
 */
export function puzzleHint(
  puzzle: Puzzle,
  grid: ValueGrid,
  score: number,
  remaining: number,
): Direction | null {
  if (remaining <= 0 || puzzleGoalReached(puzzle, grid, score)) return null;
  // score türü yol-bağımlı (kümülatif skor) → durum anahtarına skoru da kat.
  const key = (g: ValueGrid, s: number) => (puzzle.type === 'score' ? sig(g) + '#' + s : sig(g));
  const seen = new Set<string>([key(grid, score)]);
  let frontier: HintNode[] = [{ grid, score, first: null }];

  for (let depth = 0; depth < remaining; depth++) {
    const next: HintNode[] = [];
    for (const node of frontier) {
      for (const d of DIRS) {
        const r = simulateMove(node.grid, d);
        if (!r.moved) continue;
        const child: HintNode = {
          grid: r.grid,
          score: node.score + r.gained,
          first: node.first ?? d,
        };
        if (puzzleGoalReached(puzzle, child.grid, child.score)) return child.first;
        const k = key(child.grid, child.score);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(child);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}
