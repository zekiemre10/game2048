import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { PUZZLES } from '../logic/puzzles.data';
import { Direction, GameMode, GameStatus } from '../models/tile.model';

const CHAR_DIR: Record<string, Direction> = {
  U: Direction.Up,
  D: Direction.Down,
  L: Direction.Left,
  R: Direction.Right,
};

describe('Bulmaca modu — entegrasyon (GameService)', () => {
  let game: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    game = TestBed.inject(GameService);
  });

  const playSolution = (solution: string) => {
    for (const ch of solution) game.move(CHAR_DIR[ch]);
  };

  it('bulmaca başlar: mod Puzzle, hazır pozisyon yüklenir, süre değil hamle sayılır', () => {
    const p = PUZZLES[0];
    game.startPuzzle(p);
    expect(game.mode()).toBe(GameMode.Puzzle);
    expect(game.status()).toBe(GameStatus.Playing);
    expect(game.moves()).toBe(0);
    // Yüklenen taş sayısı = ızgaradaki sıfır olmayan hücreler
    const nonZero = p.grid.flat().filter((v) => v > 0).length;
    expect(game.tiles().length).toBe(nonZero);
  });

  it('çözüm oynanınca ÇÖZÜLÜR + en iyi derece (asgari hamle) kaydedilir', () => {
    const p = PUZZLES.find((x) => x.type === 'tile') ?? PUZZLES[0];
    game.startPuzzle(p);
    playSolution(p.solution);
    expect(game.status()).toBe(GameStatus.Won);
    expect(game.isPuzzleSolved(p.id)).toBe(true);
    expect(game.puzzleBestMoves(p.id)).toBe(p.minMoves);
    expect(game.puzzleSolvedCount()).toBe(1);
  });

  it('taş ÜRETİLMEZ: bulmacada boş hücre sayısı hamleyle azalmaz (deterministik)', () => {
    const p = PUZZLES.find((x) => x.type === 'clear') ?? PUZZLES[0];
    game.startPuzzle(p);
    const before = game.emptyCount();
    game.move(CHAR_DIR[p.solution[0]]);
    // Normal modda hamle sonrası taş gelir (boş −1); bulmacada gelmez → azalmaz.
    expect(game.emptyCount()).toBeGreaterThanOrEqual(before);
  });

  it('hedef kontrolü ERKEN tetiklenmez: çözüme bir hamle kala henüz çözülmemiştir', () => {
    // Asgari hamle tanımı gereği, minMoves−1 hamlede hedef HENÜZ sağlanamaz.
    const p = PUZZLES.find((x) => x.minMoves >= 3) ?? PUZZLES[0];
    game.startPuzzle(p);
    for (const ch of p.solution.slice(0, p.minMoves - 1)) game.move(CHAR_DIR[ch]);
    expect(game.status()).toBe(GameStatus.Playing); // henüz çözülmedi
    game.move(CHAR_DIR[p.solution[p.minMoves - 1]]); // son hamle çözer
    expect(game.status()).toBe(GameStatus.Won);
  });

  it('en iyi derece yalnızca DAHA İYİ (daha az) hamlede güncellenir', () => {
    const p = PUZZLES[0];
    game.startPuzzle(p);
    playSolution(p.solution);
    expect(game.puzzleBestMoves(p.id)).toBe(p.minMoves);
    // Aynı bulmacayı tekrar oyna (aynı derece) → değişmez.
    game.startPuzzle(p);
    playSolution(p.solution);
    expect(game.puzzleBestMoves(p.id)).toBe(p.minMoves);
  });
});
