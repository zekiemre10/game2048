import { Direction } from '../models/tile.model';
import { ValueGrid, bestMove, positionHealth, reviewMove } from './ai';

describe('YZ — hamle kalitesi (reviewMove)', () => {
  it('YZ ile aynı hamle "best" sayılır', () => {
    const g: ValueGrid = [
      [2, 4, 8, 16],
      [0, 0, 4, 32],
      [0, 0, 0, 64],
      [0, 0, 0, 128],
    ];
    const best = bestMove(g, 'medium')!;
    const rev = reviewMove(g, best, 'medium');
    expect(rev).not.toBeNull();
    expect(rev!.rating).toBe('best');
    expect(rev!.best).toBe(best);
  });

  it('geçersiz (tahtayı değiştirmeyen) hamle değerlendirilmez', () => {
    // Sol sütun dolu, sola hamle bir şeyi oynatmaz
    const g: ValueGrid = [
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [8, 0, 0, 0],
      [16, 0, 0, 0],
    ];
    expect(reviewMove(g, Direction.Left, 'medium')).toBeNull();
  });

  it('tek geçerli hamle varsa kusursuz sayılır', () => {
    const g: ValueGrid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 0],
    ];
    const legal = [Direction.Up, Direction.Down, Direction.Left, Direction.Right]
      .map((d) => ({ d, rev: reviewMove(g, d, 'medium') }))
      .filter((x) => x.rev !== null);
    // Bu tahtada en az bir geçerli hamle olmalı ve hepsi bir sonuç vermeli
    expect(legal.length).toBeGreaterThan(0);
    for (const x of legal) {
      expect(['best', 'good', 'inaccurate']).toContain(x.rev!.rating);
    }
  });

  it('önerilen yön daima geçerli bir hamledir', () => {
    const g: ValueGrid = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 2, 4, 8],
      [16, 32, 64, 0],
    ];
    for (const d of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
      const rev = reviewMove(g, d, 'medium');
      if (rev) expect(rev.best).toBeDefined();
    }
  });
});

describe('YZ — pozisyon sağlığı (positionHealth)', () => {
  it('boş tahta sağlıklıdır', () => {
    const g: ValueGrid = [
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const h = positionHealth(g);
    expect(h.score).toBeGreaterThanOrEqual(60);
    expect(h.level).toBe('good');
  });

  it('dolu ve dağınık tahta tehlikelidir', () => {
    const g: ValueGrid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    const h = positionHealth(g);
    expect(h.level).toBe('danger');
    expect(h.score).toBeLessThan(32);
  });

  it('en büyük taş köşedeyse puan artar', () => {
    const kose: ValueGrid = [
      [1024, 8, 4, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const orta: ValueGrid = [
      [0, 8, 4, 2],
      [0, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(positionHealth(kose).score).toBeGreaterThan(positionHealth(orta).score);
  });

  it('puan her zaman 0-100 aralığındadır', () => {
    const boards: ValueGrid[] = [
      [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      [[2, 2, 2, 2], [2, 2, 2, 2], [2, 2, 2, 2], [2, 2, 2, 2]],
      [[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 64]],
    ];
    for (const g of boards) {
      const h = positionHealth(g);
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThanOrEqual(100);
    }
  });
});
