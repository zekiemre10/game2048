import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import {
  Direction,
  GameMode,
  GameStatus,
  TIME_ATTACK_SECONDS,
} from '../models/tile.model';

describe('GameService — mod sistemi', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('Zen modu süresizdir ve 4×4 başlar', () => {
    service.startMode(GameMode.Zen, 4);
    expect(service.mode()).toBe(GameMode.Zen);
    expect(service.boardSize()).toBe(4);
    expect(service.tiles().length).toBe(2);
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('Zen modunda 2048 oluşsa bile oyun DURMAZ (kazanma yok)', () => {
    service.startMode(GameMode.Zen, 4);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 2048 oluşur
    expect(service.tiles().some((t) => t.value === 2048)).toBe(true);
    expect(service.status()).toBe(GameStatus.Playing); // durmadı
  });

  it('Zaman Yarışı sabit geri sayımla başlar', () => {
    service.startMode(GameMode.TimeAttack, 4);
    expect(service.mode()).toBe(GameMode.TimeAttack);
    expect(service.remainingSeconds()).toBe(TIME_ATTACK_SECONDS);
  });

  it('Zaman Yarışı 2048’de durmaz', () => {
    service.startMode(GameMode.TimeAttack, 4);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('farklı tahta boyutu: 5×5 ızgara üretilir', () => {
    service.startMode(GameMode.Classic, 5);
    expect(service.boardSize()).toBe(5);
    const grid = service.createEmptyGrid();
    expect(grid.length).toBe(5);
    expect(grid[0].length).toBe(5);
    expect(service.emptyCount()).toBe(25 - 2); // 2 başlangıç karesi
  });

  it('3×3 tahtada hamle mantığı çalışır', () => {
    service.startMode(GameMode.Classic, 3);
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // birleşme → 4
    expect(service.tiles().some((t) => t.value === 4)).toBe(true);
    // Yeni kare 3×3 sınırları içinde
    for (const t of service.tiles()) {
      expect(t.row).toBeLessThan(3);
      expect(t.col).toBeLessThan(3);
    }
  });

  it('restartCurrent mevcut modu ve boyutu korur', () => {
    service.startMode(GameMode.Zen, 5);
    service.restartCurrent();
    expect(service.mode()).toBe(GameMode.Zen);
    expect(service.boardSize()).toBe(5);
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('seviye modu her zaman 4×4 (boyuttan bağımsız)', () => {
    service.startMode(GameMode.Classic, 5); // önce 5×5
    service.startLevelMode();
    expect(service.boardSize()).toBe(4);
  });
});
