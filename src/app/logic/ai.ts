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

/** YZ zorluk seviyeleri. */
export type AiLevel = 'easy' | 'medium' | 'expert';

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
  const transpose = (m: ValueGrid) =>
    m[0].map((_, c) => m.map((row) => row[c]));

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
    for (let c = 0; c < n; c++) if (result[r][c] !== g[r][c]) { moved = true; break; }

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

const weightCache = new Map<number, ValueGrid>();

/**
 * "Yılan" gradyan ağırlık matrisi: en büyük ağırlık bir köşede,
 * satırlar bumerang sırayla azalır. Büyük taşları köşede tutup
 * monoton dizmeyi ödüllendirir (klasik güçlü 2048 sezgiseli).
 */
function snakeWeights(n: number): ValueGrid {
  const cached = weightCache.get(n);
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
      w[r][c] = Math.pow(base, idx);
      idx--;
    }
  }
  weightCache.set(n, w);
  return w;
}

/** Izgarayı puanlar (yüksek = daha iyi). */
export function evaluate(g: ValueGrid): number {
  const n = g.length;
  const w = snakeWeights(n);
  let weighted = 0;
  let empties = 0;
  let maxVal = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const v = g[r][c];
      if (v === 0) { empties++; continue; }
      weighted += v * w[r][c];
      if (v > maxVal) maxVal = v;
    }
  // Boş hücreler hayatta kalmayı sağlar → oyun ilerledikçe ölçeklenen ödül.
  return weighted + empties * maxVal * 4;
}

// --- Expectimax ---------------------------------------------

const NO_MOVE_PENALTY = -1e15;
const DIRECTIONS: Direction[] = [
  Direction.Up,
  Direction.Down,
  Direction.Left,
  Direction.Right,
];

/**
 * Düğüm bütçesi: aramanın toplam maliyetini SERT şekilde sınırlar.
 * Bütçe bitince dal anında sezgisel değerle kapanır. Böylece tahta
 * dolduğunda bile hesap birkaç ms sürer → arayüz asla donmaz.
 */
let budget = 0;

/** Oyuncu düğümü: en iyi hamlenin değeri. */
function maxNode(g: ValueGrid, depth: number): number {
  if (depth === 0 || budget <= 0) return evaluate(g);
  budget--;
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
  if (depth === 0 || budget <= 0) return evaluate(g);
  const cells = emptyCells(g);
  if (cells.length === 0) return evaluate(g);
  budget--;

  // Dallanmayı sınırla: en çok 4 temsilci hücre örnekle.
  const sample = cells.length > 4 ? sampleCells(cells, 4) : cells;
  let total = 0;
  const per = 1 / sample.length;
  for (const [r, c] of sample) {
    total += per * 0.9 * maxNode(placeTile(g, r, c, 2), depth);
    total += per * CHANCE_OF_FOUR * maxNode(placeTile(g, r, c, 4), depth);
  }
  return total;
}

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
 * yapıcı bir metin üretir (LLM analizi yoksa yedek olarak kullanılır).
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
  if (bestTile >= 2048) { tr.push('🏆 Muhteşem! 2048’e ulaştın.'); en.push('🏆 Amazing! You reached 2048.'); }
  else if (bestTile >= 1024) { tr.push('🔥 Çok iyi — 1024 karesini yaptın, 2048 çok yakın.'); en.push('🔥 Great — you made 1024, 2048 is close.'); }
  else if (bestTile >= 512) { tr.push('👍 İyi oyun — 512’ye ulaştın.'); en.push('👍 Good game — you reached 512.'); }
  else if (bestTile >= 256) { tr.push('🙂 Fena değil — 256 karesini yaptın.'); en.push('🙂 Not bad — you made 256.'); }
  else { tr.push('💪 Isınma turu — biraz daha pratikle daha yükseğe çıkarsın.'); en.push('💪 Warm-up round — a little more practice and you’ll climb higher.'); }

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

/** Boş hücre sayısına göre arama derinliği (performans dengesi). */
function depthFor(g: ValueGrid, maxDepth: number): number {
  const e = emptyCells(g).length;
  if (e > 8) return Math.min(maxDepth, 2);
  if (e > 4) return Math.min(maxDepth, 3);
  return maxDepth;
}

/**
 * En iyi hamleyi döndürür (hamle yoksa null).
 * `level` derinliği ve rastgeleliği belirler.
 * `rand` verilirse (0..1) kolay modda ara sıra rastgele hamle yapılır.
 */
export function bestMove(
  g: ValueGrid,
  level: AiLevel = 'medium',
  rand?: () => number,
): Direction | null {
  const legal = DIRECTIONS.filter((d) => simulateMove(g, d).moved);
  if (legal.length === 0) return null;

  // Kolay: %30 rastgele oyna (insana şans tanı)
  if (level === 'easy' && rand && rand() < 0.3) {
    return legal[Math.floor(rand() * legal.length)];
  }

  // Derinlik + düğüm bütçesi: ikisi birlikte hesabı birkaç ms'de tutar.
  const maxDepth = level === 'easy' ? 2 : level === 'medium' ? 3 : 4;
  const total = level === 'easy' ? 1200 : level === 'medium' ? 4000 : 10000;
  const depth = depthFor(g, maxDepth);

  // Bütçe yönler ARASINDA eşit paylaştırılır. Tek ortak bütçe kullanılırsa
  // ilk yön bütçeyi tüketir ve kalan yönler sığ (statik) değerle karşılaştırılır;
  // seçim liyakate değil, dizideki sıraya göre yapılmış olurdu.
  const perDir = Math.max(200, Math.floor(total / legal.length));

  let best: Direction | null = null;
  let bestVal = -Infinity;
  for (const dir of legal) {
    const { grid } = simulateMove(g, dir);
    budget = perDir; // her yöne eşit derinlik hakkı
    const v = chanceNode(grid, depth - 1);
    if (v > bestVal) {
      bestVal = v;
      best = dir;
    }
  }
  return best ?? legal[0];
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

  const maxDepth = level === 'easy' ? 2 : level === 'medium' ? 3 : 4;
  const total = level === 'easy' ? 1200 : level === 'medium' ? 4000 : 10000;
  const depth = depthFor(g, maxDepth);
  const perDir = Math.max(200, Math.floor(total / legal.length));

  let bestDir = legal[0];
  let bestVal = -Infinity;
  let playedVal = -Infinity;
  for (const dir of legal) {
    const { grid } = simulateMove(g, dir);
    budget = perDir;
    const v = chanceNode(grid, depth - 1);
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
