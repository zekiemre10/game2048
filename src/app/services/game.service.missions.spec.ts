import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameStatus } from '../models/tile.model';
import { missionDef } from '../models/mission.model';

describe('GameService — görevler', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('başlangıçta günlük ve haftalık görevler üretilir', () => {
    expect(service.dailyMissions().length).toBe(3);
    expect(service.weeklyMissions().length).toBe(3);
    // Hepsinin tanımı var
    for (const m of [...service.dailyMissions(), ...service.weeklyMissions()]) {
      expect(missionDef(m.id)).toBeTruthy();
      expect(m.progress).toBe(0);
      expect(m.claimed).toBe(false);
    }
  });

  it('hamle yapınca "moves"/"merges" görevleri ilerler', () => {
    // moves görevi olan bir günlük görev enjekte et
    service.dailyMissions.set([
      { id: 'd-move60', progress: 0, claimed: false },
      { id: 'd-merge30', progress: 0, claimed: false },
    ]);
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 1 hamle + 1 birleşme

    const moves = service.dailyMissions().find((m) => m.id === 'd-move60');
    const merges = service.dailyMissions().find((m) => m.id === 'd-merge30');
    expect(moves?.progress).toBe(1);
    expect(merges?.progress).toBe(1);
  });

  it('512 karesi yapınca "reach512" görevi tamamlanır', () => {
    service.dailyMissions.set([
      { id: 'd-512', progress: 0, claimed: false },
    ]);
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 256, row: 0, col: 0 },
      { id: 2, value: 256, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 512

    const m = service.dailyMissions().find((x) => x.id === 'd-512');
    expect(m?.progress).toBe(1); // target 1 → tamam
  });

  it('tamamlanan görevin ödülü alınır, altın artar, tekrar alınamaz', () => {
    service.dailyMissions.set([
      { id: 'd-move60', progress: 60, claimed: false },
    ]);
    const goldBefore = service.gold();
    const reward = missionDef('d-move60')!.gold;

    expect(service.claimMission('d-move60', 'daily')).toBe(true);
    expect(service.gold()).toBe(goldBefore + reward);
    expect(service.dailyMissions()[0].claimed).toBe(true);

    // Tekrar alınamaz
    expect(service.claimMission('d-move60', 'daily')).toBe(false);
  });

  it('tamamlanmamış görev alınamaz', () => {
    service.dailyMissions.set([
      { id: 'd-move60', progress: 10, claimed: false },
    ]);
    expect(service.claimMission('d-move60', 'daily')).toBe(false);
  });

  it('claimableMissions tamamlanmış-alınmamış sayar', () => {
    service.dailyMissions.set([
      { id: 'd-move60', progress: 60, claimed: false }, // hazır
      { id: 'd-merge30', progress: 5, claimed: false }, // değil
    ]);
    service.weeklyMissions.set([
      { id: 'w-win5', progress: 5, claimed: false }, // hazır
    ]);
    expect(service.claimableMissions()).toBe(2);
  });

  it('görevler localStorage’da kalıcı', () => {
    service.dailyMissions.set([
      { id: 'd-move60', progress: 60, claimed: false },
    ]);
    service.claimMission('d-move60', 'daily');

    const raw = localStorage.getItem('game2048.dailyMissions');
    expect(raw).toContain('d-move60');
    expect(raw).toContain('"claimed":true');
  });
});
