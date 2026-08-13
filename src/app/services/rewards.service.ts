import { Injectable, computed, signal } from '@angular/core';
import { dayKey, streakAfterActivity, yesterdayKey } from '../logic/daily';
import { DAILY_REWARDS, DailyReward, cycleDay, rewardForStreak } from '../logic/daily-rewards';
import { loadDailyDay, loadStreak, loadStreakDay, saveDailyDay, saveStreak } from './game-storage';

/**
 * Gün serisi (streak) + 7 günlük ödül takvimi durumu.
 *
 * Tek sorumluluk = seri ve günlük ödül DURUMU. Ödülün altını/gücü envantere
 * eklenmesi, kutlama ve seri-başarımı tetikleme çağıran tarafın (çekirdek)
 * orkestrasyonudur; bu yüzden servisin bağımlılığı YOKTUR (yaprak, döngü yok).
 */
@Injectable({ providedIn: 'root' })
export class RewardsService {
  /** Anlık gün serisi. */
  readonly currentStreak = signal<number>(loadStreak('current'));
  /** En yüksek seri. */
  readonly bestStreak = signal<number>(loadStreak('best'));
  private readonly lastActiveDay = signal<string | null>(loadStreakDay());

  /** Günlük ödülün son alındığı gün. */
  private readonly lastRewardDay = signal<string | null>(loadDailyDay());
  /** Son günlük ödül miktarı (UI gösterimi için). */
  readonly lastDailyReward = signal<number>(0);
  /** Bugün alınan ödülün ayrıntısı (arayüzde "ne kazandın" için). */
  readonly claimedReward = signal<DailyReward | null>(null);

  /** 7 günlük ödül takvimi (arayüzde gösterilir). */
  readonly rewardCalendar = DAILY_REWARDS;

  /** Bugün günlük ödül alınabilir mi? */
  readonly canClaimDaily = computed<boolean>(() => this.lastRewardDay() !== dayKey(new Date()));

  /**
   * Bugün alınacak/alınan ödülün döngüdeki günü (1-7). Ödül henüz alınmadıysa,
   * alınınca serinin NE OLACAĞI hesaplanır (seri kırıldıysa 1'e döner).
   */
  readonly rewardCycleDay = computed(() => {
    const now = new Date();
    const today = dayKey(now);
    const streak = this.canClaimDaily()
      ? streakAfterActivity(this.currentStreak(), this.lastActiveDay(), today, yesterdayKey(now))
      : this.currentStreak();
    return cycleDay(Math.max(1, streak));
  });

  /** Oyun başlangıcında günün aktivitesini kaydeder (seriyi ilerletir/kırar). */
  registerActivity(): void {
    const now = new Date();
    const today = dayKey(now);
    const yesterday = yesterdayKey(now);
    const next = streakAfterActivity(this.currentStreak(), this.lastActiveDay(), today, yesterday);
    this.currentStreak.set(next);
    if (next > this.bestStreak()) this.bestStreak.set(next);
    this.lastActiveDay.set(today);
    saveStreak(this.currentStreak(), this.bestStreak(), today);
  }

  /**
   * Günlük ödülü işler (günde bir kez): seriyi günceller, ödülü hesaplar ve ödül
   * DURUMUNU kaydeder. Altın/güç envantere ekleme + kutlama + seri-başarımı
   * çağıran tarafta (çekirdek) yapılır. @returns ödül; bugün alınmışsa null.
   */
  claimDaily(): DailyReward | null {
    const today = dayKey(new Date());
    if (this.lastRewardDay() === today) return null; // bugün alınmış

    this.registerActivity(); // seriyi güncelle
    // 7 günlük döngü: seri sürdükçe ödül büyür, aralarda güç gelir.
    const reward = rewardForStreak(this.currentStreak());
    this.lastRewardDay.set(today);
    this.lastDailyReward.set(reward.gold);
    this.claimedReward.set(reward);
    saveDailyDay(today);
    return reward;
  }
}
