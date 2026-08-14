// ============================================================
//  2048 — Güçler (tek kullanımlık, altınla satın alınır)
// ============================================================

export type PowerId = 'time' | 'bomb' | 'shuffle' | 'undo' | 'hint';

export interface PowerDef {
  id: PowerId;
  icon: string;
  /** Altın fiyatı. */
  price: number;
  /** Yalnızca seviye modunda mı işe yarar? (mağazada bilgi için) */
  levelOnly?: boolean;
}

/** Mağazadaki güçler. Metinler i18n'de: power.<id>.name · power.<id>.desc */
export const POWERS: PowerDef[] = [
  { id: 'time', icon: '⏰', price: 30, levelOnly: true },
  { id: 'bomb', icon: '💣', price: 40 },
  { id: 'shuffle', icon: '🔀', price: 25 },
  { id: 'undo', icon: '↩️', price: 20 },
  { id: 'hint', icon: '💡', price: 15 },
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
