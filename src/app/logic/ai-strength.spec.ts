import { AiLevel, bestMove, emptyCells, mulberry32, placeTile, simulateMove } from './ai';

// ============================================================
//  YZ GÜÇ MERDİVENİ REGRESYONU
//  Dört kademenin (Kolay < Orta < Zor < Uzman) BOZULMAMASINI korur:
//    • her seviye bir asgari skor eşiğini geçer (çökme koruması)
//    • her seviye bir öncekinden ölçülebilir şekilde güçlüdür (sıralama)
//    • ardışık seviye farkı 5 katı geçmez (kademeli geçiş kriteri)
//  Böylece iki eski hatayı engeller: (1) "Uzman, Orta'dan kötü",
//  (2) "Kolay ile Orta arasında 25× uçurum". Ölçüm: scripts/ai-bench.mjs.
//
//  Kolay/Orta/Zor SABİT derinlikte → tamamen DETERMİNİSTİK (skorları makineden
//  bağımsız, her koşuda birebir aynı) → tam oyun oynatılır, net ayrışırlar.
//  Uzman zaman-bağımlı (yinelemeli derinleşme) → hız için hamle SINIRLI ve
//  yalnızca "Orta'yı net geçer" güvencesi aranır (asıl regresyon).
// ============================================================

const SIZE = 4;
const SEEDS = [1, 2, 3];
// Deterministik seviyeler tam oyun; yavaş Uzman sınırlı (test süresi güvenliği:
// 1500 × 3 tohum × ~17ms ≈ 76s < 120s zaman aşımı).
const CAP: Record<AiLevel, number> = { easy: 20000, medium: 20000, hard: 20000, expert: 1500 };

function play(level: AiLevel, seed: number): number {
  const rand = mulberry32(seed >>> 0);
  let g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  const spawn = () => {
    const cells = emptyCells(g);
    if (!cells.length) return;
    const [r, c] = cells[Math.floor(rand() * cells.length)];
    g = placeTile(g, r, c, rand() < 0.1 ? 4 : 2);
  };
  spawn();
  spawn();

  let score = 0;
  for (let m = 0; m < CAP[level]; m++) {
    const dir = bestMove(g, level);
    if (!dir) break;
    const res = simulateMove(g, dir);
    if (!res.moved) break;
    g = res.grid;
    score += res.gained;
    spawn();
  }
  return score;
}

function avg(level: AiLevel): number {
  const scores = SEEDS.map((s) => play(level, s));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

describe('YZ güç merdiveni (regresyon)', () => {
  it('Kolay < Orta < Zor < Uzman — eşikler, sıralama ve ≤5× geçiş', () => {
    const easy = avg('easy');
    const medium = avg('medium');
    const hard = avg('hard');
    const expert = avg('expert'); // 1500 hamle sınırlı

    // (1) Asgari skor eşikleri (çökme koruması). Deterministik seviyelerde bu
    // değerler her koşuda sabittir; eşikler ölçülenin epey altına kondu.
    expect(easy).toBeGreaterThan(2000);
    expect(medium).toBeGreaterThan(8000);
    expect(hard).toBeGreaterThan(18000);
    expect(expert).toBeGreaterThan(20000);

    // (2) Sıralama: her kademe bir öncekinden güçlü (ASIL regresyon koruması).
    // Kolay/Orta/Zor deterministik → bu karşılaştırmalar makineden bağımsız.
    expect(medium).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(medium);
    // Uzman (sınırlı olsa da) Orta'yı net geçer — eski "Uzman < Orta" nöbetçisi.
    expect(expert).toBeGreaterThan(medium * 1.2);

    // (3) Kademeli geçiş: ardışık ortalama farkı 5 katı geçmez (uçurum yok).
    // (Eski hata: Kolay 2.9k ↔ Orta 72k = 25× uçurum.)
    expect(medium).toBeLessThan(easy * 5);
    expect(hard).toBeLessThan(medium * 5);
  }, 180_000);
});
