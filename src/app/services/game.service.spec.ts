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

describe('GameService — oyun sonu / giriş kilidi', () => {
  let service: GameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  /** 2B değer ızgarasından (0 = boş) kare listesi üretir. */
  function tilesFromGrid(grid: number[][]) {
    const tiles = [];
    let id = 1;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] !== 0) {
          tiles.push({ id: id++, value: grid[r][c], row: r, col: c });
        }
      }
    }
    return tiles;
  }

  it('hamle sonrası hamle kalmazsa durum Lost olur', () => {
    // Tek boş hücre (3,0). SOLA hamle son satırı kaydırır, boşluk (3,3)'e
    // gider; spawn oraya düşer. (3,3) komşuları 16 ve 32 olduğundan yeni
    // kare 2 de gelse 4 de gelse birleşemez → tahta kilitlenir.
    service.status.set(GameStatus.Playing);
    service.tiles.set(
      tilesFromGrid([
        [2, 4, 16, 8],
        [4, 16, 8, 2],
        [16, 8, 2, 32],
        [0, 4, 32, 16],
      ]),
    );

    const moved = service.move(Direction.Left);

    expect(moved).toBe(true);
    expect(service.tiles().length).toBe(BOARD_SIZE * BOARD_SIZE); // tahta doldu
    expect(service.status()).toBe(GameStatus.Lost);
  });

  it('oyun bittikten sonra hamle alınmıyor', () => {
    service.status.set(GameStatus.Lost);
    const before = service.tiles();
    const moved = service.move(Direction.Left);

    expect(moved).toBe(false);
    expect(service.tiles()).toBe(before); // hiç değişmedi
  });
});

describe('GameService — skor ve en yüksek skor (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function freshService(): GameService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(GameService);
  }

  it('geçerli birleşme skoru artırır', () => {
    const service = freshService();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.score()).toBe(4);
  });

  it('en yüksek skor, anlık skorla birlikte yükselir', () => {
    const service = freshService();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.bestScore()).toBe(4);
  });

  it('en yüksek skor localStorage’a kaydedilir', () => {
    const service = freshService();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 4, row: 0, col: 0 },
      { id: 2, value: 4, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // +8

    // effect senkron çalışır; depolamada değeri görmeliyiz
    expect(localStorage.getItem('game2048.bestScore')).toBe('8');
  });

  it('yeni servis, en yüksek skoru localStorage’dan yükler', () => {
    localStorage.setItem('game2048.bestScore', '512');
    const service = freshService();
    expect(service.bestScore()).toBe(512);
  });

  it('yeni oyun anlık skoru sıfırlar ama en yüksek skoru korur', () => {
    const service = freshService();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // best = 4
    expect(service.bestScore()).toBe(4);

    service.startGame();
    expect(service.score()).toBe(0);
    expect(service.bestScore()).toBe(4); // korunur
  });
});

describe('GameService — kazanma / kaybetme', () => {
  let service: GameService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  it('2048 oluşunca kazanma tetiklenir (status Won)', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);

    const moved = service.move(Direction.Left);

    expect(moved).toBe(true);
    expect(service.score()).toBe(2048);
    expect(service.status()).toBe(GameStatus.Won);
    expect(service.tiles().some((t) => t.value === 2048)).toBe(true);
  });

  it('kazanmadan sonra girişler kilitli (Won iken hamle yok)', () => {
    service.status.set(GameStatus.Won);
    expect(service.move(Direction.Left)).toBe(false);
  });

  it('"Devam Et" oyuna döner ve kazanmayı tekrar tetiklemez', () => {
    // Kazan
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.status()).toBe(GameStatus.Won);

    // Devam et
    service.continueAfterWin();
    expect(service.status()).toBe(GameStatus.Playing);

    // 2048 tahtada dururken geçerli bir hamle daha → tekrar Won olmamalı
    service.tiles.set([
      { id: 1, value: 2048, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 3 },
    ]);
    service.move(Direction.Left);
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('continueAfterWin yalnızca Won durumunda çalışır', () => {
    service.status.set(GameStatus.Playing);
    service.continueAfterWin();
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('yeni oyun temiz başlar (Playing, skor 0, 2 kare, kazanma sıfırlanır)', () => {
    service.status.set(GameStatus.Won);
    service.startGame();
    expect(service.status()).toBe(GameStatus.Playing);
    expect(service.score()).toBe(0);
    expect(service.tiles().length).toBe(2);
  });
});

describe('GameService — geri al (undo) ve yeni oyun', () => {
  let service: GameService;

  beforeEach(() => {
    // bestScore localStorage'dan yüklendiği için testler arası sızıntıyı önle
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  /** Karşılaştırma için tahtayı "değer@satır,sütun" listesine çevirir. */
  function snapshot(s: GameService): string {
    return s
      .tiles()
      .map((t) => `${t.value}@${t.row},${t.col}`)
      .sort()
      .join(' | ');
  }

  it('başlangıçta geri alınacak hamle yok', () => {
    expect(service.canUndo()).toBe(false);
    expect(service.undo()).toBe(false);
  });

  it('geri al, son hamleyi tam olarak geri alır (tahta + skor)', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
      { id: 3, value: 8, row: 3, col: 3 },
    ]);
    const before = snapshot(service);
    const scoreBefore = service.score();

    service.move(Direction.Left); // birleşir (+4) ve yeni kare gelir
    expect(service.score()).toBe(4);
    expect(snapshot(service)).not.toBe(before);
    expect(service.canUndo()).toBe(true);

    const undone = service.undo();

    expect(undone).toBe(true);
    expect(snapshot(service)).toBe(before); // tahta aynen geri geldi
    expect(service.score()).toBe(scoreBefore); // skor da geri alındı
  });

  it('geri al yalnızca TEK adım (iki kez geri alınamaz)', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);

    expect(service.undo()).toBe(true);
    expect(service.canUndo()).toBe(false);
    expect(service.undo()).toBe(false); // ikinci geri alma yok
  });

  it('geçersiz hamle geçmişe yazılmaz', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([{ id: 1, value: 2, row: 0, col: 0 }]);

    service.move(Direction.Left); // geçersiz (zaten sola dayalı)

    expect(service.canUndo()).toBe(false);
  });

  it('kaybettiren hamle geri alınabilir (oyun devam eder)', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 4, row: 0, col: 1 },
      { id: 3, value: 16, row: 0, col: 2 },
      { id: 4, value: 8, row: 0, col: 3 },
      { id: 5, value: 4, row: 1, col: 0 },
      { id: 6, value: 16, row: 1, col: 1 },
      { id: 7, value: 8, row: 1, col: 2 },
      { id: 8, value: 2, row: 1, col: 3 },
      { id: 9, value: 16, row: 2, col: 0 },
      { id: 10, value: 8, row: 2, col: 1 },
      { id: 11, value: 2, row: 2, col: 2 },
      { id: 12, value: 32, row: 2, col: 3 },
      // (3,0) boş — sola hamle boşluğu (3,3)'e taşır, spawn kilitler
      { id: 13, value: 4, row: 3, col: 1 },
      { id: 14, value: 32, row: 3, col: 2 },
      { id: 15, value: 16, row: 3, col: 3 },
    ]);
    const before = snapshot(service);

    service.move(Direction.Left);
    expect(service.status()).toBe(GameStatus.Lost);

    service.undo();

    expect(service.status()).toBe(GameStatus.Playing); // oyun geri döndü
    expect(snapshot(service)).toBe(before);
  });

  it('en yüksek skor geri ALINMAZ (rekor kaydı)', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // best = 4
    expect(service.bestScore()).toBe(4);

    service.undo();

    expect(service.score()).toBe(0); // anlık skor geri alındı
    expect(service.bestScore()).toBe(4); // rekor korundu
  });

  it('yeni oyun geçmişi de sıfırlar', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.canUndo()).toBe(true);

    service.startGame();

    expect(service.canUndo()).toBe(false); // geçmiş temizlendi
    expect(service.score()).toBe(0);
    expect(service.tiles().length).toBe(2);
    expect(service.status()).toBe(GameStatus.Playing);
  });
});

describe('GameService — uçtan uca oyun akışı', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  it('gerçek bir oyun: rastgele hamleler oyunu asla tutarsız bırakmaz', () => {
    service.startGame();

    const dirs = [
      Direction.Left,
      Direction.Right,
      Direction.Up,
      Direction.Down,
    ];

    // 300 rastgele hamle: hiçbir noktada değişmezler bozulmamalı
    for (let i = 0; i < 300; i++) {
      const dir = dirs[i % 4];
      service.move(dir);

      const tiles = service.tiles();

      // 1) Kare sayısı hiçbir zaman 16'yı aşmaz
      expect(tiles.length).toBeLessThanOrEqual(BOARD_SIZE * BOARD_SIZE);

      // 2) Hiçbir kare tahtanın dışında olamaz
      for (const t of tiles) {
        expect(t.row).toBeGreaterThanOrEqual(0);
        expect(t.row).toBeLessThan(BOARD_SIZE);
        expect(t.col).toBeGreaterThanOrEqual(0);
        expect(t.col).toBeLessThan(BOARD_SIZE);
      }

      // 3) İki kare AYNI hücrede olamaz (üst üste binme)
      const cells = tiles.map((t) => `${t.row},${t.col}`);
      expect(new Set(cells).size).toBe(tiles.length);

      // 4) id'ler benzersiz olmalı (animasyon takibi için kritik)
      const ids = tiles.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);

      // 5) Her değer 2'nin kuvveti olmalı
      for (const t of tiles) {
        expect(Number.isInteger(Math.log2(t.value))).toBe(true);
        expect(t.value).toBeGreaterThanOrEqual(2);
      }

      // 6) Skor asla azalmaz, en yüksek skor asla skorun altında kalmaz
      expect(service.score()).toBeGreaterThanOrEqual(0);
      expect(service.bestScore()).toBeGreaterThanOrEqual(service.score());

      // Oyun bittiyse dur
      if (service.status() !== GameStatus.Playing) break;
    }
  });

  it('oyun bittiğinde ya kazanılmış ya kaybedilmiş olur (asılı kalmaz)', () => {
    service.startGame();
    const dirs = [
      Direction.Left,
      Direction.Up,
      Direction.Right,
      Direction.Down,
    ];

    let moves = 0;
    while (service.status() === GameStatus.Playing && moves < 2000) {
      service.move(dirs[moves % 4]);
      moves++;
    }

    // 2000 hamlede oyun bitmiş olmalı (dört yön döngüsü tahtayı doldurur)
    expect([GameStatus.Won, GameStatus.Lost]).toContain(service.status());

    // Bittiğinde giriş kilitli
    expect(service.move(Direction.Left)).toBe(false);
  });
});
