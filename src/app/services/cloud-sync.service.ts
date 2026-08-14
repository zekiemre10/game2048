import { Injectable, inject } from '@angular/core';
import { EconomyService } from './economy.service';
import { ProfileService } from './profile.service';
import { AchievementsService } from './achievements.service';
import { AVATARS } from './game-storage';

/**
 * Bulut senkron köprüsü: hesaba kaydedilecek ilerleme anlık görüntüsü +
 * sunucudan gelen birleşmiş ilerlemenin geri uygulanması.
 *
 * Ekonomi + profil + başarım servislerini enjekte eder; her biri kendi kalıcı
 * durumunu yazar. Kalıcılık + senkron tetikleme TEK yerde toplanır (bu servis).
 */
@Injectable({ providedIn: 'root' })
export class CloudSyncService {
  private readonly economy = inject(EconomyService);
  private readonly profile = inject(ProfileService);
  private readonly achievements = inject(AchievementsService);

  /**
   * Hesaba kaydedilecek ilerleme anlık görüntüsü. Sürüm + zaman damgaları,
   * sunucunun ALAN BAZLI birleştirmesi içindir (bkz. server merge_progress):
   * rekorlar/sayaçlar MAX, başarımlar birleşim, altın MAX, ad/avatar prefsAt LWW.
   */
  snapshot(): Record<string, unknown> {
    return {
      v: 2,
      updatedAt: Date.now(),
      prefsAt: this.profile.prefsUpdatedAt(),
      gold: this.economy.gold(),
      totalGoldEarned: this.economy.totalGoldEarned(),
      bestScore: this.profile.bestScore(),
      bestLevel: this.profile.bestLevel(),
      name: this.profile.playerName(),
      avatar: this.profile.avatar(),
      championships: this.profile.championships(),
      gamesPlayed: this.profile.gamesPlayed(),
      gamesWon: this.profile.gamesWon(),
      bestTile: this.profile.bestTile(),
      totalMoves: this.profile.totalMoves(),
      achievements: [...this.achievements.unlocked()],
    };
  }

  /** Hesaptan gelen ilerlemeyi uygular ve kalıcı kaydeder. */
  apply(d: Record<string, unknown>): void {
    const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);
    const g = num(d['gold']);
    if (g !== null) this.economy.gold.set(g);
    const tge = num(d['totalGoldEarned']);
    if (tge !== null) this.economy.totalGoldEarned.set(tge);
    const bs = num(d['bestScore']);
    if (bs !== null) this.profile.bestScore.set(bs);
    const bl = num(d['bestLevel']);
    if (bl !== null) this.profile.bestLevel.set(bl);
    if (typeof d['name'] === 'string') this.profile.playerName.set(d['name'] as string);
    if (typeof d['avatar'] === 'string' && AVATARS.includes(d['avatar'] as string)) {
      this.profile.avatar.set(d['avatar'] as string);
    }
    const champ = num(d['championships']);
    if (champ !== null) this.profile.championships.set(champ);
    const gp = num(d['gamesPlayed']);
    if (gp !== null) this.profile.gamesPlayed.set(gp);
    const gw = num(d['gamesWon']);
    if (gw !== null) this.profile.gamesWon.set(gw);
    const bt = num(d['bestTile']);
    if (bt !== null) this.profile.bestTile.set(bt);
    const tm = num(d['totalMoves']);
    if (tm !== null) this.profile.totalMoves.set(tm);
    if (Array.isArray(d['achievements'])) {
      this.achievements.restore(
        (d['achievements'] as unknown[]).filter((x) => typeof x === 'string') as string[],
      );
    }
    // Tercih zaman damgası (birleşmiş değer sunucudan) — LWW tutarlılığı için.
    const pa = num(d['prefsAt']);
    if (pa !== null) this.profile.prefsUpdatedAt.set(pa);
    // Kalıcı kaydet (ekonomi + profil kendi durumunu yazar; başarımları restore kaydetti)
    this.economy.save();
    this.profile.persist();
  }
}
