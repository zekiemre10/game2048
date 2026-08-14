// ============================================================
//  2048 — Yapay zekâ (expectimax) motoru
//  Saf, çerçeveden bağımsız, tahta-boyutu parametrik.
//  Değer ızgarası (number[][]) üzerinde çalışır: 0 = boş hücre.
//  Hem "YZ'yi izle" (otomatik oynatma) hem de çok oyunculu botun
//  ortak beyni. Angular'a bağımlı DEĞİLDİR → hızlı test edilir.
// ============================================================

import { Direction } from '../models/tile.model';

export type ValueGrid = number[][];

/**
 * mulberry32: hızlı, tohumlu sözde-rastgele üretici.
 * Aynı tohum → aynı sayı dizisi (oyun ve bot birebir aynı taşları alsın diye
 * GameService ile ortak kullanılır).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** YZ zorluk seviyeleri (güç sırası: easy < medium < hard < expert). */
export type AiLevel = 'easy' | 'medium' | 'hard' | 'expert';

/** Geçerli tüm zorluk kademeleri (sıralı). Doğrulama ve UI için tek kaynak. */
export const AI_LEVELS: readonly AiLevel[] = ['easy', 'medium', 'hard', 'expert'];

/** Bir değerin geçerli bir AiLevel olup olmadığını güvenle kontrol eder. */
export function isAiLevel(x: unknown): x is AiLevel {
  return typeof x === 'string' && (AI_LEVELS as readonly string[]).includes(x);
}

const CHANCE_OF_FOUR = 0.1;

// --- Izgara yardımcıları (saf) ------------------------------

/** NxN sıfır ızgarası. */
export function emptyGrid(n: number): ValueGrid {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
}

/** Izgaranın kopyası. */
function clone(g: ValueGrid): ValueGrid {
  return g.map((row) => row.slice());
}

/** Boş hücre konumları. */
export function emptyCells(g: ValueGrid): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < g.length; r++)
    for (let c = 0; c < g.length; c++) if (g[r][c] === 0) cells.push([r, c]);
  return cells;
}

/** Bir satırı sola kaydırıp birleştirir. Dönen: {row, gained}. */
function slideRow(row: number[]): { row: number[]; gained: number } {
  const n = row.length;
  const vals = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
      const merged = vals[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // bir hamlede tek birleşme
    } else {
      out.push(vals[i]);
    }
  }
  while (out.length < n) out.push(0);
  return { row: out, gained };
}

/**
 * Bir yönde hamle uygular (saf). Dönen: {grid, moved, gained}.
 * Tüm yönler sola-kaydırmaya döndürülür (transpoze/ters çevir).
 */
export function simulateMove(
  g: ValueGrid,
  dir: Direction,
): { grid: ValueGrid; moved: boolean; gained: number } {
  const n = g.length;
  let work = clone(g);

  const reverse = (m: ValueGrid) => m.map((row) => row.slice().reverse());
  const transpose = (m: ValueGrid) => m[0].map((_, c) => m.map((row) => row[c]));

  if (dir === Direction.Up) work = transpose(work);
  else if (dir === Direction.Down) work = reverse(transpose(work));
  else if (dir === Direction.Right) work = reverse(work);

  let gained = 0;
  const slid = work.map((row) => {
    const res = slideRow(row);
    gained += res.gained;
    return res.row;
  });

  let result = slid;
  if (dir === Direction.Up) result = transpose(slid);
  else if (dir === Direction.Down) result = transpose(reverse(slid));
  else if (dir === Direction.Right) result = reverse(slid);

  // Değişti mi?
  let moved = false;
  for (let r = 0; r < n && !moved; r++)
    for (let c = 0; c < n; c++)
      if (result[r][c] !== g[r][c]) {
        moved = true;
        break;
      }

  return { grid: result, moved, gained };
}

/** Boş hücreye taş yerleştirir (yeni ızgara döner). */
export function placeTile(g: ValueGrid, r: number, c: number, v: number): ValueGrid {
  const out = clone(g);
  out[r][c] = v;
  return out;
}

/** Hiç hamle kaldı mı? */
export function hasMoves(g: ValueGrid): boolean {
  if (emptyCells(g).length > 0) return true;
  const n = g.length;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (c + 1 < n && g[r][c] === g[r][c + 1]) return true;
      if (r + 1 < n && g[r][c] === g[r + 1][c]) return true;
    }
  return false;
}

// --- Değerlendirme (heuristik) ------------------------------

const weightCache = new Map<string, ValueGrid>();

/**
 * "Yılan" gradyan ağırlık matrisi: en büyük ağırlık bir köşede,
 * satırlar bumerang sırayla azalır. Büyük taşları köşede tutup
 * monoton dizmeyi ödüllendirir (klasik güçlü 2048 sezgiseli).
 *
 * `pow` gradyanın GÜCÜnü ayarlar (zorluk kademesi için): w = base^(idx·pow).
 *   pow = 1   → tam gradyan (güçlü köşe/monotonluk disiplini)
 *   pow < 1  → gradyan DÜZLEŞİR → bot köşe düzenini daha az umursar (zayıflar,
 *              ama yine mantıklı; rastgele değil). pow = 0 → tamamen düz.
 *
 * Ağırlıklar TAM SAYIYA yuvarlanır (floor(x+0.5)). Bunun iki nedeni var:
 *   1. `pow` tek transandantal (Math.pow) işlemdir; sonucu tam sayıya sabitleyince
 *      tüm değerlendirme tam-sayı/IEEE aritmetiğine iner → sunucudaki Python bot
 *      motoruyla BİREBİR aynı sonucu üretir (bkz. server/bot_ai.py, parite testi).
 *   2. Bu tabloda hiçbir değer .5 sınırına yakın değil, dolayısıyla JS ve Python
 *      pow'u son bitte farklı yuvarlasa bile floor(x+0.5) aynı tam sayıyı verir.
 * (pow=1 için değerler zaten tam sayı: base^idx — yuvarlama etkisizdir.)
 */
function snakeWeights(n: number, pow: number): ValueGrid {
  const key = `${n}:${pow}`;
  const cached = weightCache.get(key);
  if (cached) return cached;
  const w = emptyGrid(n);
  // 5×5'te üs 24'e kadar çıkar; taban 4 olursa ağırlık×değer 5.8e17'ye ulaşır
  // ve double hassasiyeti (~64 birim) küçük taşların katkısını yok eder.
  // Daha küçük taban aynı sıralamayı verir, hassasiyeti korur.
  const base = n >= 5 ? 3 : 4;
  let idx = n * n - 1;
  for (let r = 0; r < n; r++) {
    const cols = r % 2 === 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    for (const c of cols) {
      w[r][c] = Math.floor(Math.pow(base, idx * pow) + 0.5);
      idx--;
    }
  }
  weightCache.set(key, w);
  return w;
}

// Sezgisel ZAYIFLATMA knobları — zorluk merdiveni bunlarla kurulur; her
// bestMove çağrısı seviyeye göre ayarlar (rastgele hamle YOK, bot hep mantıklı
// oynar, sadece daha az iyi):
//   heuristicSnakePow → köşe/monotonluk gradyan gücü (bkz. snakeWeights)
//   heuristicEmptyMul → boş hücre (hayatta kalma) ödülü çarpanı; düşük = daha
//                       az ileri görüşlü, tahtayı erken doldurur.
let heuristicSnakePow = 1;
let heuristicEmptyMul = 4;

/** Izgarayı puanlar (yüksek = daha iyi). */
export function evaluate(g: ValueGrid): number {
  const n = g.length;
  const w = snakeWeights(n, heuristicSnakePow);
  let weighted = 0;
  let empties = 0;
  let maxVal = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const v = g[r][c];
      if (v === 0) {
        empties++;
        continue;
      }
      weighted += v * w[r][c];
      if (v > maxVal) maxVal = v;
    }
  // Boş hücreler hayatta kalmayı sağlar → oyun ilerledikçe ölçeklenen ödül.
  return weighted + empties * maxVal * heuristicEmptyMul;
}

// --- Expectimax ---------------------------------------------

const NO_MOVE_PENALTY = -1e15;
const DIRECTIONS: Direction[] = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];

/** Yüksek çözünürlüklü saat (tarayıcı/Node/test hepsinde çalışır). */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Arama, SABİT derinlikte tam olarak yapılır (eski "düğüm bütçesi" kesintisi
 * KALDIRILDI — o, dalları farklı derinliklerde bırakıp karşılaştırmayı
 * bozuyordu). Süreyi yinelemeli derinleşme + zaman sınırı yönetir: derinlik
 * kademeli artar, süre dolunca yarım kalan derinlik ATILIR ve son TAM
 * tamamlanan derinliğin sonucu kullanılır → hep tutarlı derinlik.
 *
 * Dallanmayı bağlı tutmak için şans düğümü en çok `sampleK` boş hücre örnekler
 * (küçük K → daha derine inilebilir; büyük K → daha isabetli beklenen değer).
 */
const TIMEOUT = Symbol('ai-timeout');
let deadline = Infinity;
let sampleK = 4;
let nodeCounter = 0;
/**
 * Şans düğümünde düşük olasılıklı 4-taşı da genişletilsin mi?
 * false → yalnızca 2-taşı (0.9 olasılık) genişletilir → dallanma yarıya iner
 * → bir seviye daha DERİNE inilebilir. Uzman bunu kullanır (derinlik > isabet).
 */
let expandFour = true;

/** Süre kontrolü — her düğümde performance.now() çağırmamak için seyrek. */
function checkTime(): void {
  if ((++nodeCounter & 511) === 0 && now() > deadline) throw TIMEOUT;
}

/** Oyuncu düğümü: en iyi hamlenin değeri. */
function maxNode(g: ValueGrid, depth: number): number {
  if (depth === 0) return evaluate(g);
  checkTime();
  let best = -Infinity;
  for (const dir of DIRECTIONS) {
    const { grid, moved } = simulateMove(g, dir);
    if (!moved) continue;
    const v = chanceNode(grid, depth - 1);
    if (v > best) best = v;
  }
  return best === -Infinity ? NO_MOVE_PENALTY : best;
}

/** Şans düğümü: rastgele taş üretiminin beklenen değeri. */
function chanceNode(g: ValueGrid, depth: number): number {
  if (depth === 0) return evaluate(g);
  const cells = emptyCells(g);
  if (cells.length === 0) return evaluate(g);
  checkTime();

  // Dallanmayı sınırla: en çok sampleK temsilci hücre örnekle.
  const sample = cells.length > sampleK ? sampleCells(cells, sampleK) : cells;
  let total = 0;
  const per = 1 / sample.length;
  for (const [r, c] of sample) {
    if (expandFour) {
      total += per * 0.9 * maxNode(placeTile(g, r, c, 2), depth);
      total += per * CHANCE_OF_FOUR * maxNode(placeTile(g, r, c, 4), depth);
    } else {
      // Yalnızca 2-taşı (0.9); 4-taşı atlanır → dallanma yarı → daha derin.
      total += per * maxNode(placeTile(g, r, c, 2), depth);
    }
  }
  return total;
}

/**
 * Bir pozisyonda her yönün expectimax değerini SABİT derinlikte hesaplar.
 * (bestMove ve reviewMove ortak kullanır — tutarlı karşılaştırma.)
 * Süre dolarsa TIMEOUT fırlatır (çağıran yakalar).
 */
function scoreDirections(g: ValueGrid, legal: Direction[], depth: number): Map<Direction, number> {
  const out = new Map<Direction, number>();
  for (const dir of legal) {
    const { grid } = simulateMove(g, dir);
    out.set(dir, chanceNode(grid, depth - 1));
  }
  return out;
}

/** Seviye ayarları: derinlik aralığı, süre sınırı, şans örnekleme + sezgisel güç. */
export interface LevelCfg {
  minDepth: number;
  maxDepth: number;
  timeCapMs: number;
  sampleK: number;
  expandFour: boolean;
  /** Köşe/monotonluk gradyan gücü (1 = tam, <1 = düzleştir → zayıf). */
  snakePow: number;
  /** Boş hücre ödülü çarpanı (yüksek = daha ileri görüşlü). */
  emptyMul: number;
}
// DÖRT KADEMELİ MERDİVEN — hepsi DETERMİNİSTİK (rastgele hamle YOK).
// Ölçümle görüldü ki tek başına derinlik büyük sıçramalar yapıyor (d1~3.5k
// çöker, d2~33k, d4~70k) ve d1→d2 arasında 8k'lık bir boşluk var. Merdiven bu
// yüzden ÜÇ deterministik knobun birleşimiyle kurulur:
//   • depth   — kaç hamle ileri baktığı (baskın)
//   • sampleK — şans düğümü örnekleme genişliği (1 = kaba beklenen değer)
//   • snakePow/emptyMul — sezgisel güç (köşe disiplini + hayatta kalma ödülü)
// Değerler scripts/ai-calibrate.mjs taramasıyla ölçülen ~5k · 15k · 35k · 55k
// bandına (ardışık oran 3.0× · 2.3× · 1.6×, hepsi ≤5×) oturtuldu;
// scripts/ai-bench.mjs ile doğrulanır.
const LEVEL_CFG: Record<AiLevel, LevelCfg> = {
  // Kolay: SIĞ (d1) — sadece tek hamle ileri bakar, taş üretimini planlayamaz →
  // ~512'de tıkanır. Rastgele değil, sadece kısa görüşlü. Orta bir insan yener.
  easy: {
    minDepth: 1,
    maxDepth: 1,
    timeCapMs: 8,
    sampleK: 2,
    expandFour: true,
    snakePow: 1,
    emptyMul: 4,
  },
  // Orta: iki hamle ileri (d2) ama KABA — tek şans hücresi örnekler (sampleK 1),
  // 4-taşını yok sayar ve DÜZLEŞMİŞ gradyanla (snakePow 0.3) oynar. Mantıklı
  // ama isabetsiz → ~1024-2048 civarı. Bu, d1 ile tam-d2 arasındaki boşluğu doldurur.
  medium: {
    minDepth: 2,
    maxDepth: 2,
    timeCapMs: 12,
    sampleK: 1,
    expandFour: false,
    snakePow: 0.3,
    emptyMul: 1,
  },
  // Zor: iki hamle ileri + TAM sezgisel + isabetli beklenen değer → güçlü, çoğu insanı yener.
  hard: {
    minDepth: 2,
    maxDepth: 2,
    timeCapMs: 16,
    sampleK: 2,
    expandFour: true,
    snakePow: 1,
    emptyMul: 4,
  },
  // Uzman: yinelemeli derinleşme 3→4. minDepth 3 KRİTİK: derinlik 3 hızlıca
  // tamamlanıp bir YEDEK sağlar; sonra derinlik 4 denenir. (minDepth'i 4
  // yaparsak derinlik 4 zaman aşımına uğradığında hiç tamamlanmış derinlik
  // kalmaz ve hamle rastgele ilk yöne düşerdi.)
  expert: {
    minDepth: 3,
    maxDepth: 4,
    timeCapMs: 26,
    sampleK: 2,
    expandFour: true,
    snakePow: 1,
    emptyMul: 4,
  },
};

/**
 * Bir seviyenin ayarını çalışma anında değiştirir. YALNIZCA ölçüm/kalibrasyon
 * içindir (scripts/ai-calibrate.mjs) — uygulama kodu çağırmaz.
 */
export function configureLevel(level: AiLevel, patch: Partial<LevelCfg>): void {
  Object.assign(LEVEL_CFG[level], patch);
}

/** Bir seviyenin geçerli ayarının kopyası (ölçüm raporu için). */
export function levelConfig(level: AiLevel): LevelCfg {
  return { ...LEVEL_CFG[level] };
}

/**
 * Bir derinlikten diğerine maliyet büyüme çarpanı (kaba tahmin).
 * Bir sonraki derinliğin süresini öngörüp SIĞMAYACAKSA hiç denememek için
 * kullanılır → doğrulanamayacak derinliğe girip 26ms boşa harcanmaz.
 */
const DEPTH_GROWTH = 8;

/** Deterministik "örnekleme": eşit aralıklı hücreler (rastgelelik yok → test kararlı). */
function sampleCells(cells: Array<[number, number]>, k: number): Array<[number, number]> {
  const step = cells.length / k;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) out.push(cells[Math.floor(i * step)]);
  return out;
}

/**
 * Anahtar gerektirmeyen algoritmik oyun-sonu değerlendirmesi.
 * Skor/hamle verimliliği, en büyük kare ve köşe kullanımına göre kısa,
 * yapıcı bir metin üretir. Oyun-sonu değerlendirmesinin TEK yoludur (harici
 * bir servis/LLM yoktur — her şey istemcide, çevrimdışı çalışır).
 */
export function describeGame(
  grid: ValueGrid,
  score: number,
  moves: number,
  bestTile: number,
  lang: 'tr' | 'en',
): string {
  const n = grid.length;
  // En büyük kare köşede mi?
  let inCorner = false;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] === bestTile && bestTile > 0) {
        const corner = (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
        if (corner) inCorner = true;
      }
  const eff = moves > 0 ? Math.round(score / moves) : 0;
  const tr: string[] = [];
  const en: string[] = [];

  // Genel değerlendirme (en büyük kareye göre)
  if (bestTile >= 2048) {
    tr.push('🏆 Muhteşem! 2048’e ulaştın.');
    en.push('🏆 Amazing! You reached 2048.');
  } else if (bestTile >= 1024) {
    tr.push('🔥 Çok iyi — 1024 karesini yaptın, 2048 çok yakın.');
    en.push('🔥 Great — you made 1024, 2048 is close.');
  } else if (bestTile >= 512) {
    tr.push('👍 İyi oyun — 512’ye ulaştın.');
    en.push('👍 Good game — you reached 512.');
  } else if (bestTile >= 256) {
    tr.push('🙂 Fena değil — 256 karesini yaptın.');
    en.push('🙂 Not bad — you made 256.');
  } else {
    tr.push('💪 Isınma turu — biraz daha pratikle daha yükseğe çıkarsın.');
    en.push('💪 Warm-up round — a little more practice and you’ll climb higher.');
  }

  // Köşe stratejisi
  if (inCorner) {
    tr.push('✅ En büyük kareni köşede tutmuşsun — doğru strateji!');
    en.push('✅ You kept your biggest tile in a corner — the right strategy!');
  } else {
    tr.push('💡 En büyük kareni bir köşeye sabitle; taşları ortada bırakma.');
    en.push('💡 Anchor your biggest tile to one corner; don’t leave tiles in the center.');
  }

  // Verimlilik
  tr.push(`📊 Verimlilik: hamle başına ~${eff} puan (${moves} hamle, ${score} puan).`);
  en.push(`📊 Efficiency: ~${eff} points per move (${moves} moves, ${score} points).`);

  // Ek ipucu
  tr.push('💡 Taşları tek bir yönde (ör. sağ-alt köşeye doğru) monoton dizmeye çalış.');
  en.push('💡 Try to order tiles monotonically toward one corner (e.g. bottom-right).');

  return (lang === 'en' ? en : tr).join('\n');
}

/**
 * En iyi hamleyi döndürür (hamle yoksa null).
 * `level` derinliği/genişliği/süreyi VE sezgisel gücü belirler.
 *
 * Zorluk seviyeleri RASTGELE hamle YAPMAZ (eski %30 rastgele davranışı
 * kaldırıldı — köşe düzenini bozup ipuçlarıyla çelişiyordu). Bunun yerine
 * zayıf seviyeler sezgiseli zayıflatır (snakePow/emptyMul) ama hep mantıklı
 * oynar.
 *
 * Yinelemeli derinleşme: derinlik minDepth'ten maxDepth'e artar; her derinlik
 * TAM tamamlanır. Süre (timeCapMs) dolunca içinde bulunulan derinlik yarım
 * kalırsa ATILIR ve son tam tamamlanan derinliğin en iyi hamlesi döner.
 */
export function bestMove(g: ValueGrid, level: AiLevel = 'medium'): Direction | null {
  const legal = DIRECTIONS.filter((d) => simulateMove(g, d).moved);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const cfg = LEVEL_CFG[level];
  sampleK = cfg.sampleK;
  expandFour = cfg.expandFour;
  heuristicSnakePow = cfg.snakePow;
  heuristicEmptyMul = cfg.emptyMul;
  const start = now();
  deadline = start + cfg.timeCapMs;
  nodeCounter = 0;

  let best = legal[0];
  let prevDepthMs = 0;
  for (let depth = cfg.minDepth; depth <= cfg.maxDepth; depth++) {
    // Bir sonraki derinlik zamana SIĞMAYACAKSA hiç deneme (boşa harcama yok).
    if (depth > cfg.minDepth) {
      const elapsed = now() - start;
      if (elapsed + prevDepthMs * DEPTH_GROWTH > cfg.timeCapMs) break;
    }
    const dStart = now();
    try {
      const vals = scoreDirections(g, legal, depth);
      // Bu derinlik TAM tamamlandı → en iyisini benimse.
      let bestVal = -Infinity;
      for (const dir of legal) {
        const v = vals.get(dir)!;
        if (v > bestVal) {
          bestVal = v;
          best = dir;
        }
      }
      prevDepthMs = now() - dStart;
    } catch (e) {
      if (e === TIMEOUT) break; // (emniyet) yarım derinlik → önceki derinlik
      throw e;
    }
  }
  return best;
}

// --- Sunucu botu: deterministik oyun (parite) ---------------
//
// Çok oyunculu yarıştaki bot SUNUCUDA koşar (adil, kararlı, manipüle edilemez).
// Sunucu tohumdan botun TÜM oyununu bir kez oynatıp skor çizelgesini yayınlar.
// Bunun için bot motoru TAMAMEN DETERMİNİSTİK olmalı: SABİT derinlik (zaman
// sınırı yok) + tam-sayı ağırlıklar. Aşağıdaki botMove/playBotGame, sunucudaki
// server/bot_ai.py ile BİREBİR aynı oyunu üretir (parite: test_bot_parity.py).

/** Sunucu botunun seviye başına SABİT arama derinliği (Python ile paylaşılır). */
export const BOT_DEPTH: Record<AiLevel, number> = {
  easy: 1,
  medium: 2,
  hard: 2,
  expert: 3, // Zor'dan (2) net güçlü; Python precompute'u makul tutar.
};

/** Hamle → transkript karakteri (replay ile uyumlu; ai.ts bağımsız kalsın diye yerel). */
const BOT_MOVE_CHAR: Record<Direction, string> = {
  [Direction.Up]: 'U',
  [Direction.Down]: 'D',
  [Direction.Left]: 'L',
  [Direction.Right]: 'R',
};

/** Izgaranın en büyük karesi. */
function maxTileOf(g: ValueGrid): number {
  let m = 0;
  for (const row of g) for (const v of row) if (v > m) m = v;
  return m;
}

/**
 * Bot hamlesi: SABİT derinlikte (BOT_DEPTH), zaman sınırı OLMADAN expectimax.
 * Tamamen deterministik → aynı tahtada hep aynı hamle, makineden bağımsız.
 * (bestMove'un aksine yinelemeli derinleşme/zaman kapısı yoktur.)
 */
export function botMove(g: ValueGrid, level: AiLevel): Direction | null {
  const legal = DIRECTIONS.filter((d) => simulateMove(g, d).moved);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const cfg = LEVEL_CFG[level];
  sampleK = cfg.sampleK;
  expandFour = cfg.expandFour;
  heuristicSnakePow = cfg.snakePow;
  heuristicEmptyMul = cfg.emptyMul;
  deadline = Infinity;
  nodeCounter = 0;

  const vals = scoreDirections(g, legal, BOT_DEPTH[level]);
  let best = legal[0];
  let bestVal = -Infinity;
  for (const dir of legal) {
    const v = vals.get(dir)!;
    if (v > bestVal) {
      bestVal = v;
      best = dir;
    }
  }
  return best;
}

/** Botun oynadığı deterministik oyunun sonucu (skor ZAMAN çizelgesiyle). */
export interface BotGame {
  /** Hamleler transkripti ("ULDR…") — replay ile uyumlu. */
  moves: string;
  /** scores[k] = k. hamleden SONRA kümülatif skor (scores[0] = 0). */
  scores: number[];
  /** bests[k] = k. hamleden sonra en büyük kare (bests[0] = başlangıç). */
  bests: number[];
  maxTile: number;
  finalScore: number;
}

/**
 * Tohumdan botun oyununu SONUNA (ya da maxMoves'a) kadar oynatır ve skor
 * ZAMAN ÇİZELGESİni döndürür. Taş üretimi mulberry32 ile insan oyuncuyla AYNI
 * tohumlu diziyi kullanır (adalet). Sunucu bunu yarış başında bir kez çağırıp
 * çizelgeyi yayınlar; Python eşi server/bot_ai.py.play_bot_game.
 */
export function playBotGame(seed: number, level: AiLevel, maxMoves: number): BotGame {
  const rand = mulberry32(seed >>> 0);
  let g = emptyGrid(4);
  const spawn = () => {
    const cells = emptyCells(g);
    if (!cells.length) return;
    const [r, c] = cells[Math.floor(rand() * cells.length)];
    g = placeTile(g, r, c, rand() < CHANCE_OF_FOUR ? 4 : 2);
  };
  spawn();
  spawn();

  const moves: string[] = [];
  const scores: number[] = [0];
  const bests: number[] = [maxTileOf(g)];
  let score = 0;
  for (let m = 0; m < maxMoves; m++) {
    const dir = botMove(g, level);
    if (dir === null) break;
    const res = simulateMove(g, dir);
    if (!res.moved) break;
    g = res.grid;
    score += res.gained;
    moves.push(BOT_MOVE_CHAR[dir]);
    spawn();
    scores.push(score);
    bests.push(maxTileOf(g));
  }
  return { moves: moves.join(''), scores, bests, maxTile: maxTileOf(g), finalScore: score };
}

// --- Hamle kalitesi -----------------------------------------

/** Oynanan hamlenin YZ'ye göre kalitesi. */
export type MoveRating = 'best' | 'good' | 'inaccurate';

export interface MoveReview {
  rating: MoveRating;
  /** YZ'nin tercih ettiği yön (öğretici geri bildirim için). */
  best: Direction;
}

/**
 * Oynanan hamleyi YZ'nin seçimiyle karşılaştırır (satranç motorlarındaki
 * hamle sınıflandırmasının basit bir eşdeğeri).
 *
 * `bestMove` ile aynı aramayı yapar ama TÜM yönlerin değerini saklar,
 * böylece oyuncunun hamlesinin en iyiden ne kadar geride kaldığı ölçülür.
 */
export function reviewMove(
  g: ValueGrid,
  played: Direction,
  level: AiLevel = 'medium',
): MoveReview | null {
  const legal = DIRECTIONS.filter((d) => simulateMove(g, d).moved);
  if (legal.length === 0 || !legal.includes(played)) return null;
  // Tek seçenek varsa kıyaslanacak bir şey yok → kusursuz say.
  if (legal.length === 1) return { rating: 'best', best: played };

  // Hamle kalitesi SABİT derinlikte ve TAM sezgiselle değerlendirilir (tüm
  // yönler eşit derinlikte, nesnel güçte kıyaslanmalı). Süre sınırı yok.
  sampleK = 3;
  expandFour = true;
  heuristicSnakePow = 1;
  heuristicEmptyMul = 4;
  deadline = Infinity;
  nodeCounter = 0;
  const vals = scoreDirections(g, legal, 4);

  let bestDir = legal[0];
  let bestVal = -Infinity;
  let playedVal = -Infinity;
  for (const dir of legal) {
    const v = vals.get(dir)!;
    if (dir === played) playedVal = v;
    if (v > bestVal) {
      bestVal = v;
      bestDir = dir;
    }
  }

  if (played === bestDir) return { rating: 'best', best: bestDir };

  // Göreli kayıp: değerler tahta ağırlıkları yüzünden çok büyük olabildiği
  // için mutlak fark değil, en iyi değere ORANLA bakılır.
  const span = Math.abs(bestVal) || 1;
  const loss = (bestVal - playedVal) / span;
  return { rating: loss < 0.03 ? 'good' : 'inaccurate', best: bestDir };
}

// --- Pozisyon sağlığı ---------------------------------------

export type HealthLevel = 'good' | 'risky' | 'danger';

export interface PositionHealth {
  /** 0-100 arası sağlık puanı. */
  score: number;
  level: HealthLevel;
}

/**
 * Tahtanın "sağlığı" — arama YAPMAZ, üç açıklanabilir etkenden hesaplanır:
 *   • boş hücre oranı (nefes alma payı)
 *   • en büyük taş köşede mi (klasik 2048 stratejisi)
 *   • kaç yöne hamle kaldı (sıkışma riski)
 * Oyuncuya neden riskli olduğunu anlatabilecek kadar şeffaf tutuldu.
 */
export function positionHealth(g: ValueGrid): PositionHealth {
  const n = g.length;
  const cells = n * n;
  const empties = emptyCells(g).length;

  // Boş alan: doluluk arttıkça hızla düşen bir pay
  const roomScore = Math.min(1, empties / (cells * 0.35)) * 50;

  // En büyük taş köşede mi?
  let maxVal = 0;
  for (const row of g) for (const v of row) if (v > maxVal) maxVal = v;
  const corners = [g[0][0], g[0][n - 1], g[n - 1][0], g[n - 1][n - 1]];
  const cornerScore = maxVal > 0 && corners.includes(maxVal) ? 25 : 0;

  // Hamle özgürlüğü
  const moves = DIRECTIONS.filter((d) => simulateMove(g, d).moved).length;
  const moveScore = (moves / DIRECTIONS.length) * 25;

  const score = Math.round(roomScore + cornerScore + moveScore);
  const level: HealthLevel = score >= 60 ? 'good' : score >= 32 ? 'risky' : 'danger';
  return { score, level };
}

/**
 * Oyun sonu hamle zaman çizelgesinin tek bir noktası: bir hamlenin yönü,
 * kalitesi, o hamleden SONRAKİ pozisyon sağlığı ve kümülatif skor + hamle
 * ÖNCESİ tahta (tıklanınca gösterilir). Kalite/öneri asistan kapalıyken null.
 */
export interface TimelinePoint {
  /** 1'den başlayan hamle numarası. */
  move: number;
  /** Oynanan yön. */
  direction: Direction;
  /** Hamle kalitesi — asistan kapalıysa null. */
  rating: MoveRating | null;
  /** YZ'nin önerdiği yön — asistan kapalıysa null (tıklanınca yeniden hesaplanır). */
  best: Direction | null;
  /** Hamleden SONRA pozisyon sağlığı (0-100). */
  health: number;
  /** Hamleden sonra kümülatif skor. */
  score: number;
  /** Hamleden ÖNCE tahta (karar anı; tıklanınca gösterilir + YZ önerisi buradan). */
  grid: ValueGrid;
}

/**
 * Dönüm noktası: sağlığın en sert düştüğü hamlenin dizini (index). Ardışık iki
 * nokta arasındaki en büyük sağlık DÜŞÜŞÜNÜ arar. Nokta yoksa/düşüş yoksa -1.
 */
export function findTurningPoint(points: TimelinePoint[]): number {
  let worst = -1;
  let worstDrop = 0;
  for (let i = 1; i < points.length; i++) {
    const drop = points[i - 1].health - points[i].health;
    if (drop > worstDrop) {
      worstDrop = drop;
      worst = i;
    }
  }
  return worst;
}
