// ============================================================
//  2048 — Güçler (tek kullanımlık, altınla satın alınır)
// ============================================================

export type PowerId = 'time' | 'bomb' | 'shuffle' | 'undo' | 'hint';

export interface PowerDef {
  id: PowerId;
  icon: string;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
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
    nameEn: '+30 Seconds',
    desc: 'Seviye süresine 30 saniye ekler',
    descEn: 'Adds 30 seconds to the level timer',
    price: 30,
    levelOnly: true,
  },
  {
    id: 'bomb',
    icon: '💣',
    name: 'Bomba',
    nameEn: 'Bomb',
    desc: 'Seçtiğin bir kareyi siler',
    descEn: 'Removes a tile you pick',
    price: 40,
  },
  {
    id: 'shuffle',
    icon: '🔀',
    name: 'Karıştır',
    nameEn: 'Shuffle',
    desc: 'Tahtayı yeniden dağıtır',
    descEn: 'Redistributes the board',
    price: 25,
  },
  {
    id: 'undo',
    icon: '↩️',
    name: 'Ekstra Geri Al',
    nameEn: 'Extra Undo',
    desc: 'Bir hamle geri alır',
    descEn: 'Undoes one move',
    price: 20,
  },
  {
    id: 'hint',
    icon: '💡',
    name: 'İpucu',
    nameEn: 'Hint',
    desc: 'En iyi hamleyi gösterir',
    descEn: 'Shows the best move',
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
