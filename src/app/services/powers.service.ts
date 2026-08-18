import { Injectable, inject, signal } from '@angular/core';
import { Direction } from '../models/tile.model';
import { PowerId, PowerInventory } from '../models/power.model';
import { EconomyService } from './economy.service';
import { EconomySettingsService } from './economy-settings.service';
import { loadPowers, savePowers } from './game-storage';

/**
 * Güç durumu: envanter (her güçten kaç adet) + oturum bayrakları (bomba
 * hedefleme modu, ipucu yönü, bu oyunda güç kullanıldı mı) + satın alma.
 *
 * Tek sorumluluk = güç DURUMU ve satın alma. Satın alma için EconomyService'e
 * (yaprak) bağlıdır. Güçlerin ETKİSİ (bomba/karıştır/+30sn/ipucu) tahtayı,
 * süreyi ve oyun akışını değiştirdiğinden çekirdek GameService'te orkestre edilir;
 * bu servis çekirdeğe bağlı DEĞİLDİR (döngü olmaz).
 */
@Injectable({ providedIn: 'root' })
export class PowersService {
  private readonly economy = inject(EconomyService);
  private readonly econSettings = inject(EconomySettingsService);

  /** Güç envanteri (her güçten kaç adet). */
  readonly inventory = signal<PowerInventory>(loadPowers());

  /** Bomba hedefleme modu açık mı? (bir kareye dokununca silinir) */
  readonly bombMode = signal<boolean>(false);

  /** İpucu yönü (kısa süre gösterilir, sonra temizlenir). */
  readonly hintDirection = signal<Direction | null>(null);

  /** Bu oyunda güç kullanıldı mı? (kullanılan oyun sıralama dışıdır) */
  readonly usedThisGame = signal<boolean>(false);

  /** İpucu yönünü otomatik temizleyen zamanlayıcı. */
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  /** İpucu yönünü gösterir ve kısa süre sonra otomatik temizler. */
  showHint(dir: Direction): void {
    this.hintDirection.set(dir);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (typeof setTimeout !== 'undefined') {
      this.hintTimer = setTimeout(() => this.hintDirection.set(null), 2500);
    }
  }

  /** Güç efektlerini temizler (yeni oyun/seviye/reset'te): bomba modu + ipucu. */
  clearFx(): void {
    this.bombMode.set(false);
    this.hintDirection.set(null);
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  /** Bir gücü altınla satın alır (envantere ekler). @returns başarılıysa true. */
  buy(id: PowerId): boolean {
    if (!this.economy.spend(this.econSettings.powerPrice(id))) return false;
    this.inventory.update((inv) => ({ ...inv, [id]: inv[id] + 1 }));
    savePowers(this.inventory());
    return true;
  }

  /** Envanterden bir güç düşer (0'ın altına inmez). */
  decrement(id: PowerId): void {
    this.inventory.update((inv) => ({ ...inv, [id]: Math.max(0, inv[id] - 1) }));
    savePowers(this.inventory());
  }

  /** Envantere güç ekler (günlük/şampiyonluk ödülü). */
  add(id: PowerId, count: number): void {
    this.inventory.update((inv) => ({ ...inv, [id]: inv[id] + count }));
    savePowers(this.inventory());
  }
}
