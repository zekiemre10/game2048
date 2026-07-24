import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameMode, GameStatus } from '../models/tile.model';
import { utcDayKey } from '../logic/daily-challenge';

describe('GameService — günlük meydan okuma modu', () => {
  let service: GameService;

  const boardOf = (s: GameService) =>
    JSON.stringify(
      s
        .tiles()
        .map((t) => ({ v: t.value, r: t.row, c: t.col }))
        .sort((a, b) => a.r - b.r || a.c - b.c),
    );

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('günlük mod doğru kurulur', () => {
    service.startDaily();
    expect(service.mode()).toBe(GameMode.Daily);
    expect(service.status()).toBe(GameStatus.Playing);
    expect(service.boardSize()).toBe(4); // günlük her zaman 4×4
    expect(service.tiles().length).toBe(2);
    expect(service.dailyDay()).toBe(utcDayKey());
    expect(service.remainingSeconds()).toBe(180);
  });

  it('AYNI gün AYNI başlangıç tahtasını verir (adil)', () => {
    service.startDaily();
    const first = boardOf(service);
    service.startDaily();
    expect(boardOf(service)).toBe(first);
  });

  it('aynı hamle dizisi aynı tahtayı üretir (tohumlu akış)', () => {
    const play = () => {
      service.startDaily();
      for (const d of [Direction.Left, Direction.Down, Direction.Left, Direction.Up]) {
        service.move(d);
      }
      return boardOf(service);
    };
    expect(play()).toBe(play());
  });

  it('günlükte geri alma YOK (tohumlu akış bozulmasın)', () => {
    service.startDaily();
    for (const d of [Direction.Left, Direction.Down, Direction.Up, Direction.Right]) {
      if (service.move(d)) break;
    }
    expect(service.undo()).toBe(false);
  });

  it('"tekrar dene" aynı günün tahtasını yeniden kurar', () => {
    service.startDaily();
    const first = boardOf(service);
    for (let i = 0; i < 5; i++) {
      service.move([Direction.Left, Direction.Down][i % 2]);
    }
    service.restartCurrent();
    expect(service.mode()).toBe(GameMode.Daily);
    expect(service.score()).toBe(0);
    expect(boardOf(service)).toBe(first);
  });

  it('günlük moddan çıkıp klasik başlatınca tohum bırakılır', () => {
    service.startDaily();
    service.startMode(GameMode.Classic);
    expect(service.mode()).toBe(GameMode.Classic);
    // Klasik oyun tohumsuzdur: arka arkaya iki oyun genelde farklı olur.
    // (Kesin eşitsizlik iddia etmiyoruz — sadece mod ve durum doğrulanır.)
    expect(service.status()).toBe(GameStatus.Playing);
  });
});
