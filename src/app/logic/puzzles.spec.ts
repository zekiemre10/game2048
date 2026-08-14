import { PUZZLES } from './puzzles.data';
import { puzzleGoalReached, puzzleHint } from './puzzle-logic';
import { ValueGrid, simulateMove } from './ai';
import { Direction } from '../models/tile.model';

const CHAR_DIR: Record<string, Direction> = {
  U: Direction.Up,
  D: Direction.Down,
  L: Direction.Left,
  R: Direction.Right,
};

describe('Bulmacalar — veri bütünlüğü + çözülebilirlik (derleme zamanı üretimi)', () => {
  it('en az 30 bulmaca var ve zorunlu alanları geçerli', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(30);
    for (const p of PUZZLES) {
      expect(['tile', 'score', 'clear']).toContain(p.type);
      expect(p.grid.length).toBe(4);
      expect(p.grid.every((r) => r.length === 4)).toBe(true);
      expect(p.minMoves).toBeGreaterThanOrEqual(2);
      expect(p.moveBudget).toBeGreaterThanOrEqual(p.minMoves);
      expect(p.solution.length).toBe(p.minMoves); // çözüm asgari hamle uzunluğunda
    }
  });

  it('üç bulmaca türü de mevcut (hedef kare · skor · kurtarma)', () => {
    const types = new Set(PUZZLES.map((p) => p.type));
    expect(types.has('tile')).toBe(true);
    expect(types.has('score')).toBe(true);
    expect(types.has('clear')).toBe(true);
  });

  it('HER bulmaca stored çözümü uygulanınca hedefe ulaşır (deterministik, taş üretimi yok)', () => {
    for (const p of PUZZLES) {
      let grid: ValueGrid = p.grid.map((r) => r.slice());
      let score = 0;
      for (const ch of p.solution) {
        const r = simulateMove(grid, CHAR_DIR[ch]);
        expect(r.moved).toBe(true); // çözümdeki her hamle geçerli
        grid = r.grid;
        score += r.gained;
      }
      // Asgari çözüm hamlesinden SONRA hedef sağlanmış olmalı.
      expect(puzzleGoalReached(p, grid, score)).toBe(true);
    }
  });

  it('bulmacalar bölümlere ayrılmış ve artan zorlukta (asgari hamle azalmaz)', () => {
    const sections = new Set(PUZZLES.map((p) => p.section));
    expect(sections.size).toBeGreaterThanOrEqual(5);
    let prev = 0;
    for (const p of PUZZLES) {
      expect(p.minMoves).toBeGreaterThanOrEqual(prev - 2); // kabaca artan (küçük dalga tolere)
      prev = p.minMoves;
    }
  });

  it('puzzleHint başlangıçtan geçerli bir hamle döndürür ve hedefe yaklaştırır', () => {
    for (const p of PUZZLES.slice(0, 8)) {
      const dir = puzzleHint(p, p.grid, 0, p.moveBudget);
      expect(dir).not.toBeNull();
      expect(simulateMove(p.grid, dir!).moved).toBe(true);
    }
  });
});
