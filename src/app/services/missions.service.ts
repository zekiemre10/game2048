import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DAILY_COUNT,
  DAILY_POOL,
  MissionMetric,
  MissionProgress,
  WEEKLY_COUNT,
  WEEKLY_POOL,
  missionDef,
} from '../models/mission.model';
import { pickMissions, weekKey } from '../logic/missions';
import { dayKey } from '../logic/daily';
import { EconomyService } from './economy.service';
import {
  DAILY_MISSIONS_KEY,
  WEEKLY_MISSIONS_KEY,
  loadMissions,
  saveMissions,
} from './game-storage';

/**
 * Görevler: günlük + haftalık görev listeleri, ilerleme ve ödül alma.
 *
 * Tek sorumluluk = görev durumu. Ödül altını için EconomyService'e (yaprak
 * servis) bağlıdır; çekirdeğe bağlı DEĞİLDİR (döngü olmaz). Oyun olaylarını
 * çekirdek `track()` ile bildirir ve YZ oynadıysa ilerlemeyi durdurmak için
 * `aiPlayed` bayrağını parametre olarak geçer.
 */
@Injectable({ providedIn: 'root' })
export class MissionsService {
  private readonly economy = inject(EconomyService);

  /** Günlük görevler (id, ilerleme, alındı). */
  readonly daily = signal<MissionProgress[]>([]);

  /** Haftalık görevler. */
  readonly weekly = signal<MissionProgress[]>([]);

  /** Alınmayı bekleyen (tamamlanmış ama alınmamış) görev sayısı. */
  readonly claimable = computed<number>(() => {
    const count = (list: MissionProgress[]) =>
      list.filter((m) => {
        const def = missionDef(m.id);
        return def && !m.claimed && m.progress >= def.target;
      }).length;
    return count(this.daily()) + count(this.weekly());
  });

  /** Son tazelenen dönem — her hamlede loadMissions'a gitmeyi önler. */
  private period = { day: '', week: '' };

  /** Dönem (gün/hafta) değiştiyse görev listelerini yeniler; değişmediyse iş yapmaz. */
  ensureFresh(): void {
    const now = new Date();
    const today = dayKey(now);
    const week = weekKey(now);

    // Dönem değişmediyse iş yok (sık çağrılır: her hamlede).
    if (this.period.day === today && this.period.week === week) {
      return;
    }
    this.period = { day: today, week };

    const daily = loadMissions(DAILY_MISSIONS_KEY);
    if (daily.period !== today) {
      const defs = pickMissions(DAILY_POOL, DAILY_COUNT, today);
      const list = defs.map((d) => ({ id: d.id, progress: 0, claimed: false }));
      this.daily.set(list);
      saveMissions(DAILY_MISSIONS_KEY, today, list);
    } else {
      this.daily.set(daily.list);
    }

    const weekly = loadMissions(WEEKLY_MISSIONS_KEY);
    if (weekly.period !== week) {
      const defs = pickMissions(WEEKLY_POOL, WEEKLY_COUNT, week);
      const list = defs.map((d) => ({ id: d.id, progress: 0, claimed: false }));
      this.weekly.set(list);
      saveMissions(WEEKLY_MISSIONS_KEY, week, list);
    } else {
      this.weekly.set(weekly.list);
    }
  }

  /**
   * Bir metrik için görev ilerlemesini artırır (günlük + haftalık).
   * `aiPlayed` true ise (YZ oynadıysa) ilerleme sayılmaz.
   */
  track(metric: MissionMetric, amount: number, aiPlayed: boolean): void {
    if (amount <= 0) return;
    // Sekme gece yarısını aşarak açık kalmış olabilir: ilerlemeden önce
    // dönemi tazele, yoksa dünün görevleri ilerlemeye devam ederdi.
    this.ensureFresh();
    if (aiPlayed) return; // YZ oynadıysa görevler ilerlemez
    this.bump(this.daily, DAILY_MISSIONS_KEY, metric, amount);
    this.bump(this.weekly, WEEKLY_MISSIONS_KEY, metric, amount);
  }

  private bump(sig: typeof this.daily, key: string, metric: MissionMetric, amount: number): void {
    let changed = false;
    const next = sig().map((m) => {
      const def = missionDef(m.id);
      if (!def || def.metric !== metric || m.claimed) return m;
      const progress = Math.min(def.target, m.progress + amount);
      if (progress !== m.progress) changed = true;
      return { ...m, progress };
    });
    if (changed) {
      sig.set(next);
      // period'u koru (bu gün/hafta)
      const stored = loadMissions(key);
      saveMissions(key, stored.period, next);
    }
  }

  /**
   * Tamamlanmış bir görevin ödülünü alır. Altın eklemenin yanında "altın kazan"
   * görevini de ilerletir (eski davranış: claim → addGold → trackMission('gold')).
   */
  claim(id: string, type: 'daily' | 'weekly', aiPlayed: boolean): boolean {
    this.ensureFresh(); // dün açık kalan sekmeden ödül alınmasın
    const sig = type === 'daily' ? this.daily : this.weekly;
    const key = type === 'daily' ? DAILY_MISSIONS_KEY : WEEKLY_MISSIONS_KEY;
    const def = missionDef(id);
    if (!def) return false;

    const mission = sig().find((m) => m.id === id);
    if (!mission || mission.claimed || mission.progress < def.target) {
      return false;
    }

    this.economy.add(def.gold);
    this.track('gold', def.gold, aiPlayed); // altın kazanç görevini de ilerlet
    const next = sig().map((m) => (m.id === id ? { ...m, claimed: true } : m));
    sig.set(next);
    const stored = loadMissions(key);
    saveMissions(key, stored.period, next);
    return true;
  }
}
