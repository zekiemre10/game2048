import { applyMove, hasAnyMove, slideLine, toValueGrid } from './board-logic';
import { Direction, Tile } from '../models/tile.model';

let idCounter = 1;
function t(value: number, row: number, col: number): Tile {
  return { id: idCounter++, value, row, col };
}

/** Bir yönün sonucunu 2B değer ızgarası olarak döndürür (0 = boş). */
function moveToGrid(tiles: Tile[], dir: Direction): number[][] {
  return toValueGrid(applyMove(tiles, dir).tiles);
}

describe('slideLine (tek satır sıkıştır + birleştir)', () => {
  it('2 2 4 → 4 4 (zincirleme birleşme YOK)', () => {
    const { placed, gained } = slideLine([
      { id: 1, value: 2 },
      { id: 2, value: 2 },
      { id: 3, value: 4 },
    ]);
    expect(placed.map((p) => p.value)).toEqual([4, 4]);
    expect(gained).toBe(4);
  });

  it('2 2 2 2 → 4 4 (çift birleşme yok, 8 değil)', () => {
    const { placed, gained } = slideLine([
      { id: 1, value: 2 },
      { id: 2, value: 2 },
      { id: 3, value: 2 },
      { id: 4, value: 2 },
    ]);
    expect(placed.map((p) => p.value)).toEqual([4, 4]);
    expect(gained).toBe(8); // 4 + 4
  });

  it('4 4 4 → 8 4 (ilk çift birleşir, üçüncü kalır)', () => {
    const { placed, gained } = slideLine([
      { id: 1, value: 4 },
      { id: 2, value: 4 },
      { id: 3, value: 4 },
    ]);
    expect(placed.map((p) => p.value)).toEqual([8, 4]);
    expect(gained).toBe(8);
  });

  it('birleşen kare, hayatta kalan karenin id’sini korur', () => {
    const { placed } = slideLine([
      { id: 10, value: 2 },
      { id: 20, value: 2 },
    ]);
    expect(placed.length).toBe(1);
    expect(placed[0].id).toBe(10);
    expect(placed[0].merged).toBe(true);
  });
});

describe('applyMove — 4 yön', () => {
  it('SOL: bir satır sola sıkışır', () => {
    // . 2 . 2  →  4 . . .
    const grid = moveToGrid([t(2, 0, 1), t(2, 0, 3)], Direction.Left);
    expect(grid[0]).toEqual([4, 0, 0, 0]);
  });

  it('SAĞ: bir satır sağa sıkışır', () => {
    // 2 . 2 .  →  . . . 4
    const grid = moveToGrid([t(2, 0, 0), t(2, 0, 2)], Direction.Right);
    expect(grid[0]).toEqual([0, 0, 0, 4]);
  });

  it('YUKARI: bir sütun yukarı sıkışır', () => {
    // sütun 0: satır1=2, satır3=2 → satır0=4
    const grid = moveToGrid([t(2, 1, 0), t(2, 3, 0)], Direction.Up);
    expect([grid[0][0], grid[1][0], grid[2][0], grid[3][0]]).toEqual([
      4, 0, 0, 0,
    ]);
  });

  it('AŞAĞI: bir sütun aşağı sıkışır', () => {
    const grid = moveToGrid([t(2, 0, 0), t(2, 2, 0)], Direction.Down);
    expect([grid[0][0], grid[1][0], grid[2][0], grid[3][0]]).toEqual([
      0, 0, 0, 4,
    ]);
  });

  it('SOL: 2 2 4 satırı → 4 4 (bir hamlede çift birleşme yok)', () => {
    const grid = moveToGrid(
      [t(2, 0, 0), t(2, 0, 1), t(4, 0, 2)],
      Direction.Left,
    );
    expect(grid[0]).toEqual([4, 4, 0, 0]);
  });
});

describe('applyMove — skor ve geçerlilik', () => {
  it('birleşen değeri skora ekler', () => {
    const res = applyMove([t(2, 0, 0), t(2, 0, 1)], Direction.Left);
    expect(res.gained).toBe(4);
    expect(res.moved).toBe(true);
  });

  it('birden fazla birleşmenin skorunu toplar', () => {
    // satır: 2 2 4 4 → 4 8 ; kazanç = 4 + 8 = 12
    const res = applyMove(
      [t(2, 0, 0), t(2, 0, 1), t(4, 0, 2), t(4, 0, 3)],
      Direction.Left,
    );
    expect(res.gained).toBe(12);
  });

  it('geçersiz hamle: ızgara değişmezse moved=false', () => {
    // Zaten sola dayalı tek kare, sola hamle bir şey değiştirmez
    const res = applyMove([t(2, 0, 0)], Direction.Left);
    expect(res.moved).toBe(false);
    expect(res.gained).toBe(0);
  });

  it('saf: girdiyi değiştirmez', () => {
    const input = [t(2, 0, 1), t(2, 0, 3)];
    const snapshot = input.map((x) => ({ ...x }));
    applyMove(input, Direction.Left);
    expect(input).toEqual(snapshot);
  });
});

describe('hasAnyMove (oyun sonu tespiti)', () => {
  it('boş hücre varsa hamle vardır', () => {
    expect(hasAnyMove([t(2, 0, 0)])).toBe(true);
  });

  it('dolu tahtada komşu eşitse hamle vardır', () => {
    const tiles: Tile[] = [];
    let v = 2;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        tiles.push(t(r === 0 && c < 2 ? 2 : v++, r, c));
      }
    }
    // ilk iki hücre 2,2 → sola/sağa birleşebilir
    expect(hasAnyMove(tiles)).toBe(true);
  });

  it('dolu ve kilitli tahtada (kenar komşuları hep farklı) hamle yoktur', () => {
    // Satranç tahtası gibi 2/4 deseni → hiçbir komşu eşit değil
    const tiles: Tile[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        tiles.push(t((r + c) % 2 === 0 ? 2 : 4, r, c));
      }
    }
    expect(hasAnyMove(tiles)).toBe(false);
  });
});
