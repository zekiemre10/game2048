// ============================================================
//  2048 — Güçler (tek kullanımlık, altınla satın alınır)
// ============================================================

export type PowerId = 'time' | 'bomb' | 'shuffle' | 'undo' | 'hint';

export interface PowerDef {
  id: PowerId;
  icon: string;
  name: string;
  desc: string;
  /** Altın fiyatı. */
  price: number;
  /** Yalnızca seviye modunda mı işe yarar? (mağazada bilgi için) */
  levelOnly?: boolean;
}

/** Mağazadaki güçler. */
export const POWERS: PowerDef[] = [
  {
    id: 'time',
    icon: '⏰',
    name: '+30 Saniye',
    desc: 'Seviye süresine 30 saniye ekler',
    price: 30,
    levelOnly: true,
  },
  {
    id: 'bomb',
    icon: '💣',
    name: 'Bomba',
    desc: 'Seçtiğin bir kareyi siler',
    price: 40,
  },
  {
    id: 'shuffle',
    icon: '🔀',
    name: 'Karıştır',
    desc: 'Tahtayı yeniden dağıtır',
    price: 25,
  },
  {
    id: 'undo',
    icon: '↩️',
    name: 'Ekstra Geri Al',
    desc: 'Bir hamle geri alır',
    price: 20,
  },
  {
    id: 'hint',
    icon: '💡',
    name: 'İpucu',
    desc: 'En iyi hamleyi gösterir',
    price: 15,
  },
];

/** Her güçten sahip olunan adet. */
export type PowerInventory = Record<PowerId, number>;

/** Boş envanter. */
export function emptyInventory(): PowerInventory {
  return { time: 0, bomb: 0, shuffle: 0, undo: 0, hint: 0 };
}

/** Bir gücün tanımını döndürür. */
export function powerDef(id: PowerId): PowerDef {
  return POWERS.find((p) => p.id === id)!;
}
