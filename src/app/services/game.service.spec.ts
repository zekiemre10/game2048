import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { BOARD_SIZE, Direction, GameStatus } from '../models/tile.model';

describe('GameService', () => {
  let service: GameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  it('boş ızgara 4×4 ve tamamen null olmalı', () => {
    const grid = service.createEmptyGrid();
    expect(grid.length).toBe(BOARD_SIZE);
    for (const row of grid) {
      expect(row.length).toBe(BOARD_SIZE);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
  });

  it('başlangıçta 0 skor ve Idle durum olmalı', () => {
    expect(service.score()).toBe(0);
    expect(service.status()).toBe(GameStatus.Idle);
    expect(service.tiles().length).toBe(0);
  });

  it('startGame tam 2 rastgele kare oluşturmalı', () => {
    service.startGame();
    expect(service.tiles().length).toBe(2);
    expect(service.status()).toBe(GameStatus.Playing);
    expect(service.emptyCount()).toBe(BOARD_SIZE * BOARD_SIZE - 2);
  });

  it('oluşan kareler geçerli değer (2 veya 4) ve geçerli konumda olmalı', () => {
    service.startGame();
    for (const t of service.tiles()) {
      expect([2, 4]).toContain(t.value);
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeLessThan(BOARD_SIZE);
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.col).toBeLessThan(BOARD_SIZE);
    }
    // İki karenin id'leri benzersiz olmalı (animasyon için kritik)
    const ids = service.tiles().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('grid signal, tiles listesiyle senkron güncellenmeli', () => {
    service.startGame();
    let occupied = 0;
    for (const row of service.grid()) {
      for (const cell of row) {
        if (cell) occupied++;
      }
    }
    expect(occupied).toBe(2);
  });

  it('geçerli hamle: skoru artırır ve yeni kare ekler', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);

    const moved = service.move(Direction.Left);

    expect(moved).toBe(true);
    expect(service.score()).toBe(4);
    // birleşme sonrası 1 kare kalır + 1 yeni spawn = 2
    expect(service.tiles().length).toBe(2);
  });

  it('geçersiz hamle: yeni kare üretmez, skor değişmez', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([{ id: 1, value: 2, row: 0, col: 0 }]);

    const moved = service.move(Direction.Left);

    expect(moved).toBe(false);
    expect(service.tiles().length).toBe(1);
    expect(service.score()).toBe(0);
  });

  it('oyun oynanmıyorken hamle yok sayılır', () => {
    service.reset(); // Idle
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    expect(service.move(Direction.Left)).toBe(false);
  });
});

describe('GameService — spawnRandomTile (rastgele yeni kare)', () => {
  let service: GameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  /** Tahtayı tamamen dolduran 16 kare üretir. */
  function fullBoard() {
    const tiles = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        tiles.push({ id: r * BOARD_SIZE + c + 1, value: 2, row: r, col: c });
      }
    }
    return tiles;
  }

  it('boş hücreye yeni kare ekler (yeni, benzersiz id + isNew)', () => {
    service.tiles.set([{ id: 100, value: 2, row: 0, col: 0 }]);
    const tile = service.spawnRandomTile();

    expect(tile).not.toBeNull();
    expect(tile!.isNew).toBe(true);
    expect(tile!.id).not.toBe(100);
    expect(service.tiles().length).toBe(2);
    // Yeni kare gerçekten boş bir hücreye kondu (0,0 dolu değil)
    expect(tile!.row === 0 && tile!.col === 0).toBe(false);
  });

  it('dolu ızgaraya kare EKLEMEZ (null döner)', () => {
    service.tiles.set(fullBoard());
    const tile = service.spawnRandomTile();

    expect(tile).toBeNull();
    expect(service.tiles().length).toBe(BOARD_SIZE * BOARD_SIZE); // 16, artmadı
  });

  it('yeni kare değeri her zaman 2 veya 4 olmalı', () => {
    for (let i = 0; i < 200; i++) {
      service.tiles.set([]);
      const tile = service.spawnRandomTile();
      expect([2, 4]).toContain(tile!.value);
    }
  });

  it('2/4 oranı yaklaşık %90/%10 olmalı', () => {
    const N = 4000;
    let fours = 0;
    for (let i = 0; i < N; i++) {
      service.tiles.set([]); // her seferinde boş tahta
      const tile = service.spawnRandomTile();
      if (tile!.value === 4) fours++;
    }
    const fourRatio = fours / N;
    // Beklenen %10; istatistiksel sapma için geniş tolerans
    expect(fourRatio).toBeGreaterThan(0.06);
    expect(fourRatio).toBeLessThan(0.14);
  });

  it('emptyCells dolu tahtada boş liste döndürür', () => {
    service.tiles.set(fullBoard());
    expect(service.emptyCells().length).toBe(0);
  });
});
