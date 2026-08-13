import { Direction, Tile } from '../models/tile.model';
import { applyMove, toValueGrid } from './board-logic';
import { mulberry32 } from './ai';
import { moveGrid, replayGame } from './replay';
import { REPLAY_FIXTURES } from './replay.fixtures.generated';

describe('replay — replayGame, fixture üreteci ile BİREBİR aynı', () => {
  it('150 fixture transkriptinde skor ve en büyük kare eşleşir', () => {
    for (const f of REPLAY_FIXTURES) {
      const r = replayGame(f.seed, f.moves, f.size);
      expect(r.valid).toBe(true);
      expect(r.score).toBe(f.score);
      expect(r.maxTile).toBe(f.maxTile);
    }
  });
});

// Değer ızgarasını Tile[] listesine çevirir (applyMove ile kıyas için).
function tilesFrom(grid: number[][]): Tile[] {
  const tiles: Tile[] = [];
  let id = 1;
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid.length; c++)
      if (grid[r][c] !== 0) tiles.push({ id: id++, value: grid[r][c], row: r, col: c });
  return tiles;
}

describe("replay — moveGrid, oyunun applyMove'u ile BİREBİR aynı", () => {
  const DIRS = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];

  it('rastgele 2000 tahtada değer sonucu ve kazanç birebir eşleşir', () => {
    const rand = mulberry32(20260101);
    for (let iter = 0; iter < 2000; iter++) {
      const n = [3, 4, 5][Math.floor(rand() * 3)];
      // Rastgele tahta üret (bazı hücreler dolu, 2..1024 güçleri)
      const grid = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => {
          const r = rand();
          if (r < 0.45) return 0;
          return 2 ** (1 + Math.floor(rand() * 10)); // 2..2048
        }),
      );
      const dir = DIRS[Math.floor(rand() * 4)];

      const mine = moveGrid(grid, dir);
      const theirs = applyMove(tilesFrom(grid), dir, n);
      const theirsGrid = toValueGrid(theirs.tiles, n);

      expect(mine.gained).toBe(theirs.gained);
      expect(mine.moved).toBe(theirs.moved);
      expect(mine.grid).toEqual(theirsGrid);
    }
  });
});

describe('replay — geçersiz transkript reddi', () => {
  it('bilinmeyen karakter → valid=false', () => {
    expect(replayGame(1, 'UDLRX', 4).valid).toBe(false);
  });

  it('tahtayı değiştirmeyen hamle → valid=false (sahte transkript)', () => {
    // Boş dizi geçerli; ama art arda aynı yön çoğu zaman geçersiz olur.
    // Kesin bir geçersiz durum kur: replay sırasında bir noktada moved=false.
    // 1000 rastgele tohumda en az bir geçersiz zincir bul ve reddedildiğini gör.
    let sawInvalid = false;
    for (let s = 1; s <= 200 && !sawInvalid; s++) {
      const r = replayGame(s, 'UUUUUUUUUU', 4); // üst üste yukarı — bir yerde geçersizleşir
      if (!r.valid) sawInvalid = true;
    }
    expect(sawInvalid).toBe(true);
  });

  it('boş hamle dizisi geçerlidir (skor 0)', () => {
    const r = replayGame(42, '', 4);
    expect(r.valid).toBe(true);
    expect(r.score).toBe(0);
  });
});
