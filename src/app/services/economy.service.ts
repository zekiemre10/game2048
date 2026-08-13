import { Injectable, signal } from '@angular/core';
import { loadGold, loadTotalEarned, saveGold, saveTotalEarned } from './game-storage';

/**
 * Altın ekonomisi: mevcut altın + bugüne kadarki toplam kazanç.
 *
 * Tek sorumluluk = altın bakiyesi ve kalıcılığı. Oyun/görev/başarım gibi
 * yan etkiler (ör. "altın kazan" görevi) çağıran tarafta kalır; bu servisin
 * hiçbir bağımlılığı yoktur (döngüsel bağımlılık engellenir).
 */
@Injectable({ providedIn: 'root' })
export class EconomyService {
  /** Harcanabilir altın. */
  readonly gold = signal<number>(loadGold());

  /** Bugüne kadar kazanılan toplam altın (istatistik/başarım için). */
  readonly totalGoldEarned = signal<number>(loadTotalEarned());

  /** Altın ekler (kazanç → toplam kazancı da artırır). */
  add(amount: number): void {
    if (amount <= 0) return;
    this.gold.update((g) => g + amount);
    this.totalGoldEarned.update((t) => t + amount);
    this.save();
  }

  /** Altın harcar. Yeterli değilse harcamaz. @returns başarılıysa true. */
  spend(amount: number): boolean {
    if (this.gold() < amount) return false;
    this.gold.update((g) => g - amount);
    saveGold(this.gold());
    return true;
  }

  /** Mevcut altın + toplam kazancı kalıcı kaydeder (ör. bulut geri yükleme sonrası). */
  save(): void {
    saveGold(this.gold());
    saveTotalEarned(this.totalGoldEarned());
  }
}
