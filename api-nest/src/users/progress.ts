// ============================================================
//  Bulut senkronu: ALAN BAZLI BİRLEŞTİRME (app.py merge_progress birebir).
//  Son-yazan-kazanır DEĞİL. Rekor/sayaç→MAX, başarım→BİRLEŞİM, altın bakiyesi
//  →kazanılan/harcanan ayrı MAX, tercih→prefsAt LWW. v:2 damgalar.
// ============================================================

const MERGE_MAX_FIELDS = [
  'bestScore', 'bestLevel', 'bestTile',
  'gamesPlayed', 'gamesWon', 'totalMoves', 'championships',
  'totalGoldEarned',
] as const;

type Dict = Record<string, unknown>;

/** d[k] negatif olmayan sayı ise onu, değilse 0 (bool sayı sayılmaz). */
function mnum(d: unknown, k: string): number {
  const v = d && typeof d === 'object' ? (d as Dict)[k] : undefined;
  return typeof v === 'number' && !Number.isNaN(v) && v >= 0 ? v : 0;
}

/** İki ilerleme bloğunu alan bazlı birleştirir. base=saklanan, inc=gelen. */
export function mergeProgress(base: unknown, inc: unknown): Dict {
  const b: Dict = base && typeof base === 'object' ? (base as Dict) : {};
  const i: Dict = inc && typeof inc === 'object' ? (inc as Dict) : {};
  const out: Dict = {};

  for (const f of MERGE_MAX_FIELDS) {
    out[f] = Math.max(mnum(b, f), mnum(i, f));
  }

  const earned = out['totalGoldEarned'] as number;
  const spentBase = Math.max(0, mnum(b, 'totalGoldEarned') - mnum(b, 'gold'));
  const spentInc = Math.max(0, mnum(i, 'totalGoldEarned') - mnum(i, 'gold'));
  const spent = Math.min(earned, Math.max(spentBase, spentInc));
  out['gold'] = Math.max(0, earned - spent);

  const ach = new Set<string>();
  for (const src of [b, i]) {
    const arr = src['achievements'];
    if (Array.isArray(arr)) for (const x of arr) if (typeof x === 'string') ach.add(x);
  }
  out['achievements'] = [...ach].sort();

  const baseAt = mnum(b, 'prefsAt');
  const incAt = mnum(i, 'prefsAt');
  const [primary, secondary] = incAt > baseAt ? [i, b] : [b, i];
  for (const f of ['name', 'avatar']) {
    if (typeof primary[f] === 'string') out[f] = primary[f];
    else if (typeof secondary[f] === 'string') out[f] = secondary[f];
  }
  out['prefsAt'] = Math.max(baseAt, incAt);

  out['v'] = 2;
  out['updatedAt'] = Math.max(mnum(b, 'updatedAt'), mnum(i, 'updatedAt'));
  return out;
}

/** Arkadaş/skor tablosu için oyun verisinden özet (app.py friend_public). */
export function friendPublic(row: { id: number; username: string; data: string }): {
  id: number;
  username: string;
  bestScore: number;
  bestLevel: number;
  bestTile: number;
} {
  let data: Dict = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }
  return {
    id: row.id,
    username: row.username,
    bestScore: Math.trunc(Number(data['bestScore']) || 0),
    bestLevel: Math.trunc(Number(data['bestLevel']) || 1),
    bestTile: Math.trunc(Number(data['bestTile']) || 0),
  };
}
