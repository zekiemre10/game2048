import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { BOARD_SIZE, GameStatus } from '../models/tile.model';

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
});
