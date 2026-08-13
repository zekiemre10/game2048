import { Injectable, signal } from '@angular/core';
import { ACHIEVEMENTS, Achievement } from '../models/achievement.model';
import { loadAchievements, saveAchievements } from './game-storage';

/** İlk kez 2048'e ulaşma başarımının hedefi. */
const WIN_VALUE = 2048;

/**
 * Başarım koşullarının okuduğu anlık oyuncu ilerlemesi. Çekirdek bu görüntüyü
 * (profil + ekonomi + seri sinyallerinden) toplayıp geçer; böylece bu servisin
 * başka servise bağımlılığı OLMAZ (yaprak servis, döngü yok).
 */
export interface AchievementStats {
  bestTile: number;
  bestLevel: number;
  gamesPlayed: number;
  bestStreak: number;
  bombUsed: boolean;
  totalGoldEarned: number;
}

/**
 * Başarımlar: açılan başarım kümesi + koşul/ilerleme değerlendirmesi.
 *
 * Tek sorumluluk = başarım durumu. Koşullar için gereken oyun verisi PARAMETRE
 * olarak geçer (`AchievementStats`); ödül altını ve kutlama ise çağıran tarafın
 * (çekirdek) orkestrasyonudur. Böylece servis tamamen yaprak kalır.
 */
@Injectable({ providedIn: 'root' })
export class AchievementsService {
  /** Açılmış başarım id'leri. */
  readonly unlocked = signal<Set<string>>(loadAchievements());

  /** Bir başarım açık mı? */
  isUnlocked(id: string): boolean {
    return this.unlocked().has(id);
  }

  /**
   * Bir başarımın ilerlemesi: `{ current, target }` (kilitli çubuğu çizmek için).
   */
  progress(id: string, s: AchievementStats): { current: number; target: number } {
    const clamp = (cur: number, target: number) => ({ current: Math.min(cur, target), target });
    switch (id) {
      case 'tile-512':
        return clamp(s.bestTile, 512);
      case 'tile-1024':
        return clamp(s.bestTile, 1024);
      case 'first-win':
        return clamp(s.bestTile, WIN_VALUE);
      case 'level-3':
        return clamp(s.bestLevel, 3);
      case 'games-10':
        return clamp(s.gamesPlayed, 10);
      case 'streak-3':
        return clamp(s.bestStreak, 3);
      case 'streak-7':
        return clamp(s.bestStreak, 7);
      case 'bomb-use':
        return clamp(s.bombUsed ? 1 : 0, 1);
      case 'rich':
        return clamp(s.totalGoldEarned, 1000);
      default:
        return { current: 0, target: 1 };
    }
  }

  private met(id: string, s: AchievementStats): boolean {
    switch (id) {
      case 'tile-512':
        return s.bestTile >= 512;
      case 'tile-1024':
        return s.bestTile >= 1024;
      case 'first-win':
        return s.bestTile >= WIN_VALUE;
      case 'level-3':
        return s.bestLevel >= 3;
      case 'games-10':
        return s.gamesPlayed >= 10;
      case 'streak-3':
        return s.bestStreak >= 3;
      case 'streak-7':
        return s.bestStreak >= 7;
      case 'bomb-use':
        return s.bombUsed;
      case 'rich':
        return s.totalGoldEarned >= 1000;
      default:
        return false;
    }
  }

  /**
   * Koşulu yeni sağlanan başarımları açar + kaydeder ve açılan tanımları döndürür.
   * Altın ödülü + kutlama çağıran tarafta (çekirdek) yapılır.
   */
  unlockNew(s: AchievementStats): Achievement[] {
    const newly: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked().has(a.id)) continue;
      if (this.met(a.id, s)) {
        this.unlocked.update((set) => new Set(set).add(a.id));
        newly.push(a);
      }
    }
    if (newly.length) saveAchievements(this.unlocked());
    return newly;
  }

  /** Bulut geri yükleme: açılmış başarım kümesini olduğu gibi ata + kaydet. */
  restore(ids: string[]): void {
    this.unlocked.set(new Set(ids));
    saveAchievements(this.unlocked());
  }
}
