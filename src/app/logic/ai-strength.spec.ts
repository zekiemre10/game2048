import {
  AiLevel,
  bestMove,
  emptyCells,
  mulberry32,
  placeTile,
  simulateMove,
} from './ai';

// ============================================================
//  YZ GÜÇ REGRESYONU
//  Zorluk merdiveninin BOZULMAMASINI korur: Kolay < Orta < Uzman.
//  Özellikle "Uzman, Orta'dan daha kötü" hatasının geri gelmesini
//  engeller (ölçüm: scripts/ai-bench.mjs).
//
//  Hız için: her oyun HAMLE SINIRLI (tam oyun değil) ve az sayıda
//  tohum. Orta/Kolay sabit derinlikte → deterministik; Uzman zaman-
//  bağımlı ama aynı tahtada Orta'yı geçmeli.
// ============================================================

const SIZE = 4;
// Uzman'ın derinlik avantajı YÜKSEK karelere ulaşılan uzun oyunlarda çıkar;
// kısa oyunda (ilk birkaç yüz hamle) Orta ile Uzman benzer oynar. Bu yüzden
// oyunlar yeterince uzun oynatılır (ama tam-oyun değil, testi makul tutmak için).
const MAX_MOVES = 1500;
const SEEDS = [1, 2, 3]; // seviye başına oyun (Uzman ~17ms/hamle → 3 yeterli)

function playCapped(level: AiLevel, seed: number): number {
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
  for (let m = 0; m < MAX_MOVES; m++) {
    const dir = bestMove(g, level, rand);
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
  const scores = SEEDS.map((s) => playCapped(level, s));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

describe('YZ güç merdiveni (regresyon)', () => {
  it('Kolay < Orta < Uzman (asgari eşikler + sıralama)', () => {
    const easy = avg('easy');
    const medium = avg('medium');
    const expert = avg('expert');

    // Asgari skor eşikleri — 1500 HAMLE SINIRLI oyunlar (tam-oyun değil).
    // Tam oyunda easy≈1400, medium≈30000, expert≈65000; sınırlı oyunda daha
    // düşük. Eşikler ölçülen sınırlı-oyun değerlerinden geniş marjla kondu.
    expect(easy).toBeGreaterThan(150);
    expect(medium).toBeGreaterThan(4000);
    expect(expert).toBeGreaterThan(10000);

    // Zorluk sıralaması korunmalı — ASIL regresyon koruması.
    // (Eski hata: Uzman, Orta'dan KÖTÜ oynuyordu.)
    expect(medium).toBeGreaterThan(easy * 2);
    // Uzman en az %20 daha iyi (kabul kriteri). Gerçek marj çok daha büyük.
    expect(expert).toBeGreaterThan(medium * 1.2);
  }, 120_000);
});
