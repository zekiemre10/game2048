import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameMode, GameStatus } from '../models/tile.model';
import { replayGame } from '../logic/replay';

// ============================================================
//  KRİTİK PARİTE TESTİ
//  Gerçek GameService oyunu ile replayGame(tohum, hamleler) BİREBİR
//  aynı skoru vermeli. Aksi hâlde sunucu meşru oyunları reddederdi.
// ============================================================

describe('GameService — oyun ↔ replay paritesi', () => {
  let service: GameService;
  const DIRS = [Direction.Up, Direction.Left, Direction.Down, Direction.Right];

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('50 rastgele Klasik oyun: skor ve en büyük kare replay ile aynı', () => {
    for (let game = 0; game < 50; game++) {
      service.startMode(GameMode.Classic);
      // Rastgele ama geçerli hamlelerle oyna
      let guard = 0;
      while (service.status() === GameStatus.Playing && guard < 400) {
        service.move(DIRS[Math.floor(Math.random() * 4)]);
        guard++;
      }
      const t = service.gameTranscript();
      const replay = replayGame(t.seed, t.moves, t.size);

      expect(replay.valid).toBe(true);
      expect(replay.score).toBe(service.score());
      expect(replay.maxTile).toBe(service.currentBestTile());
    }
  });

  it('5×5 tahtada da parite korunur', () => {
    for (let game = 0; game < 20; game++) {
      service.startMode(GameMode.Zen, 5);
      let guard = 0;
      while (service.status() === GameStatus.Playing && guard < 400) {
        service.move(DIRS[Math.floor(Math.random() * 4)]);
        guard++;
      }
      const t = service.gameTranscript();
      const replay = replayGame(t.seed, t.moves, t.size);
      expect(replay.valid).toBe(true);
      expect(replay.score).toBe(service.score());
    }
  });

  it('güç kullanılınca oyun sıralama dışı işaretlenir', () => {
    service.startMode(GameMode.Classic);
    expect(service.powerUsedThisGame()).toBe(false);
    service.powers.set({ ...service.powers(), bomb: 1 });
    service.usePower('bomb');
    const t = service.tiles()[0];
    service.removeTileAt(t.row, t.col);
    expect(service.powerUsedThisGame()).toBe(true);
  });

  it('yeni oyun güç bayrağını ve hamle kaydını sıfırlar', () => {
    service.startMode(GameMode.Classic);
    service.powers.set({ ...service.powers(), shuffle: 1 });
    service.usePower('shuffle');
    expect(service.powerUsedThisGame()).toBe(true);

    service.startMode(GameMode.Classic);
    expect(service.powerUsedThisGame()).toBe(false);
    expect(service.gameTranscript().moves).toBe('');
  });

  it('her oyunun tohumu farklı (rastgele)', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      service.startMode(GameMode.Classic);
      seeds.add(service.gameSeed());
    }
    // 30 oyunda çakışma pratikte olmaz
    expect(seeds.size).toBeGreaterThan(28);
  });
});
