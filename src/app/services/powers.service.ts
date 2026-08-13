import { Injectable, inject, signal } from '@angular/core';
import { Direction } from '../models/tile.model';
import { PowerId, PowerInventory, powerDef } from '../models/power.model';
import { EconomyService } from './economy.service';
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

  /** Güç envanteri (her güçten kaç adet). */
  readonly inventory = signal<PowerInventory>(loadPowers());

  /** Bomba hedefleme modu açık mı? (bir kareye dokununca silinir) */
  readonly bombMode = signal<boolean>(false);

  /** İpucu yönü (kısa süre gösterilir, sonra temizlenir). */
  readonly hintDirection = signal<Direction | null>(null);

  /** Bu oyunda güç kullanıldı mı? (kullanılan oyun sıralama dışıdır) */
  readonly usedThisGame = signal<boolean>(false);

  /** Bir gücü altınla satın alır (envantere ekler). @returns başarılıysa true. */
  buy(id: PowerId): boolean {
    if (!this.economy.spend(powerDef(id).price)) return false;
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
