import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameStatus } from '../models/tile.model';

describe('GameService — profil / istatistik / seri / günlük / başarım', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  // --- İsim ---
  it('varsayılan isim Oyuncu; ayarlanabilir ve kalıcı', () => {
    expect(service.playerName()).toBe('Oyuncu');
    service.setName('  Emre  ');
    expect(service.playerName()).toBe('Emre'); // trim
    expect(localStorage.getItem('game2048.name')).toBe('Emre');
    service.setName('');
    expect(service.playerName()).toBe('Oyuncu'); // boş → varsayılan
  });

  // --- İstatistik ---
  it('oyun kazanılınca istatistik güncellenir (oyun/kazanma/hamle)', () => {
    service.startGame();
    service.status.set(GameStatus.Playing);
    service.moves.set(5);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 2048 → Won

    expect(service.status()).toBe(GameStatus.Won);
    expect(service.gamesPlayed()).toBe(1);
    expect(service.gamesWon()).toBe(1);
    expect(service.totalMoves()).toBeGreaterThanOrEqual(6); // 5 + bu hamle
  });

  it('en yüksek kare izlenir (bestTile)', () => {
    service.startGame();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 256, row: 0, col: 0 },
      { id: 2, value: 256, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 512 oluşur
    expect(service.bestTile()).toBeGreaterThanOrEqual(512);
  });

  // --- Günlük ödül + seri ---
  it('günlük ödül bir kez alınır, altın verir, seri başlar', () => {
    expect(service.canClaimDaily()).toBe(true);
    const goldBefore = service.gold();

    expect(service.claimDailyReward()).toBe(true);
    expect(service.gold()).toBeGreaterThan(goldBefore);
    expect(service.currentStreak()).toBe(1);
    expect(service.canClaimDaily()).toBe(false);

    // İkinci kez aynı gün → alınamaz
    expect(service.claimDailyReward()).toBe(false);
  });

  // --- Başarımlar ---
  it('512 karesi başarımı açılır ve altın verir', () => {
    service.startGame();
    service.status.set(GameStatus.Playing);
    const goldBefore = service.gold();
    service.tiles.set([
      { id: 1, value: 256, row: 0, col: 0 },
      { id: 2, value: 256, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 512

    expect(service.unlockedAchievements().has('tile-512')).toBe(true);
    expect(service.gold()).toBeGreaterThan(goldBefore); // ödül eklendi
  });

  it('2048 başarımı (İlk Zafer) açılır', () => {
    service.startGame();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 1024, row: 0, col: 0 },
      { id: 2, value: 1024, row: 0, col: 1 },
    ]);
    service.move(Direction.Left); // 2048
    expect(service.unlockedAchievements().has('first-win')).toBe(true);
  });

  it('başarım altını toplam kazanca eklenir; başarımlar kalıcı', () => {
    service.startGame();
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 256, row: 0, col: 0 },
      { id: 2, value: 256, row: 0, col: 1 },
    ]);
    service.move(Direction.Left);
    expect(service.unlockedAchievements().has('tile-512')).toBe(true);

    // Yeni servis başarımı hatırlar → tekrar ödül vermez
    const total = service.totalGoldEarned();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const s2 = TestBed.inject(GameService);
    expect(s2.unlockedAchievements().has('tile-512')).toBe(true);
    expect(s2.totalGoldEarned()).toBe(total);
    s2.reset();
  });

  it('kazanma yüzdesi doğru hesaplanır', () => {
    service.gamesPlayed.set(4);
    service.gamesWon.set(1);
    expect(service.winRate()).toBe(25);
    service.gamesPlayed.set(0);
    expect(service.winRate()).toBe(0);
  });
});
