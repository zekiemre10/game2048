import { TestBed } from '@angular/core/testing';
import { AVATARS, GameService } from './game.service';
import { ACHIEVEMENTS } from '../models/achievement.model';

describe('GameService — profil (başarım ilerlemesi, ünvan, avatar)', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('her başarım için bir ilerleme değeri döner', () => {
    for (const a of ACHIEVEMENTS) {
      const p = service.achievementProgress(a.id);
      expect(p.target).toBeGreaterThan(0);
      expect(p.current).toBeGreaterThanOrEqual(0);
      expect(p.current).toBeLessThanOrEqual(p.target); // asla hedefi aşmaz
    }
  });

  it('ilerleme mevcut istatistiği yansıtır', () => {
    service.bestTile.set(128);
    expect(service.achievementProgress('tile-512')).toEqual({
      current: 128,
      target: 512,
    });

    service.gamesPlayed.set(3);
    expect(service.achievementProgress('games-10')).toEqual({
      current: 3,
      target: 10,
    });

    service.totalGoldEarned.set(150);
    expect(service.achievementProgress('rich')).toEqual({
      current: 150,
      target: 1000,
    });
  });

  it('hedefi aşan değer kırpılır (çubuk %100 üstüne çıkmaz)', () => {
    service.bestTile.set(4096);
    const p = service.achievementProgress('tile-512');
    expect(p.current).toBe(512);
  });

  it('ünvan istatistiklerle birlikte yükselir', () => {
    const first = service.rankInfo().rank.id;
    service.gamesPlayed.set(50);
    service.bestScore.set(20000);
    service.bestLevel.set(5);
    const later = service.rankInfo();
    expect(later.points).toBeGreaterThan(0);
    // 500 + 1000 + 250 = 1750 → Usta
    expect(later.rank.id).not.toBe(first);
  });

  it('avatar seçilir ve kalıcı olur', () => {
    const pick = AVATARS[3];
    service.setAvatar(pick);
    expect(service.avatar()).toBe(pick);
    expect(localStorage.getItem('game2048.avatar')).toBe(pick);
  });

  it('listede olmayan avatar reddedilir', () => {
    const before = service.avatar();
    service.setAvatar('<script>');
    expect(service.avatar()).toBe(before);
  });

  it('avatar hesap anlık görüntüsüne girer ve geri yüklenir', () => {
    service.setAvatar(AVATARS[5]);
    const snap = service.accountSnapshot();
    expect(snap['avatar']).toBe(AVATARS[5]);

    service.setAvatar(AVATARS[0]);
    service.applyAccountSnapshot(snap);
    expect(service.avatar()).toBe(AVATARS[5]);
  });
});
