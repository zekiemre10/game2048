import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { DAILY_REWARDS } from '../logic/daily-rewards';

describe('GameService — 7 günlük ödül alma', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('ilk gün ödülü alınır ve altın eklenir', () => {
    const goldBefore = service.gold();
    expect(service.canClaimDaily()).toBe(true);
    expect(service.claimDailyReward()).toBe(true);
    expect(service.gold()).toBe(goldBefore + DAILY_REWARDS[0].gold);
    expect(service.canClaimDaily()).toBe(false);
  });

  it('aynı gün ikinci kez alınamaz', () => {
    expect(service.claimDailyReward()).toBe(true);
    const gold = service.gold();
    expect(service.claimDailyReward()).toBe(false); // tekrar yok
    expect(service.gold()).toBe(gold);
  });

  it('güç veren günde envantere güç eklenir', () => {
    // 3. gün bombadır → seriyi 2'ye kur, ödül alınca 3 olur
    service.currentStreak.set(2);
    const bombBefore = service.powers().bomb;
    expect(service.claimDailyReward()).toBe(true);
    const reward = service.claimedReward();
    expect(reward).not.toBeNull();
    if (reward?.power === 'bomb') {
      expect(service.powers().bomb).toBe(bombBefore + reward.powerCount);
    }
  });

  it('alınan ödülün ayrıntısı saklanır', () => {
    service.claimDailyReward();
    const r = service.claimedReward();
    expect(r).not.toBeNull();
    expect(r!.day).toBeGreaterThanOrEqual(1);
    expect(r!.day).toBeLessThanOrEqual(7);
  });

  it('gösterilen döngü günü 1-7 arasındadır', () => {
    for (const streak of [0, 1, 3, 7, 8, 20]) {
      service.currentStreak.set(streak);
      const d = service.rewardCycleDay();
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  it('takvim arayüze açılır ve 7 gün içerir', () => {
    expect(service.rewardCalendar.length).toBe(7);
  });

  it('ödül alınca kutlama tetiklenir', () => {
    expect(service.celebration()).toBeNull();
    service.claimDailyReward();
    expect(service.celebration()).not.toBeNull();
  });
});
