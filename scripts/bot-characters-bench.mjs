// ============================================================
//  Bot KARAKTER güç ölçümü (scripts/bot-characters-bench.mjs)
//
//  Gerçek TS bot motorunu (src/app/logic/ai.ts) esbuild ile derler ve her
//  karakteri N tohumda DETERMİNİSTİK oynatır (yarışın kullandığı playBotGame
//  yolu — bestMove değil). Ortalama skor + 2048'e ulaşma oranı + en büyük kare
//  dağılımını raporlar. Bu sayılar seçim ekranındaki "ölçülmüş güç" verisini
//  (src/app/logic/ai.ts BOT_CHARACTER_STRENGTH) besler.
//
//  Çalıştır:  node scripts/bot-characters-bench.mjs [oyunSayisi]
// ============================================================
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const out = await build({
  entryPoints: [resolve(ROOT, 'src/app/logic/ai.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const dir = mkdtempSync(join(tmpdir(), 'charbench-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { playBotGameByKey, BOT_CHARACTER_IDS } = await import(pathToFileURL(file).href);
unlinkSync(file);

const N = Number(process.argv[2] || 40);
// Doğal ölüme kadar oyna (2048'e ~1000+ hamle gerekir) → yüksek üst sınır.
const MAX_MOVES = 20000;
// Deterministik tohumlar (ai-bench.mjs ile aynı üreteç → karşılaştırılabilir).
const seeds = Array.from({ length: N }, (_, i) => (0x1234 + i * 2654435761) >>> 0);

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

console.log(`\nBot karakter gücü — ${N} oyun/karakter (deterministik playBotGame yolu)\n`);
console.log('Karakter | Ort.skor | Medyan | 2048% | En büyük kare dağılımı');
console.log('-'.repeat(78));

const report = {};
for (const id of BOT_CHARACTER_IDS) {
  const scores = [];
  const tiles = [];
  for (const seed of seeds) {
    const g = playBotGameByKey(seed, id, MAX_MOVES);
    scores.push(g.finalScore);
    tiles.push(g.maxTile);
  }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / N);
  const median = pct(scores, 0.5);
  const reach2048 = Math.round((tiles.filter((t) => t >= 2048).length / N) * 100);
  // En büyük kare dağılımı
  const dist = {};
  for (const t of tiles) dist[t] = (dist[t] || 0) + 1;
  const distStr = Object.keys(dist)
    .map(Number)
    .sort((a, b) => a - b)
    .map((t) => `${t}×${dist[t]}`)
    .join(' ');
  const peak = Math.max(...tiles);
  const floor = Math.min(...tiles);
  report[id] = { avg, median, reach2048, peakTile: peak, floorTile: floor };
  console.log(
    `${id.padEnd(9)}| ${String(avg).padStart(8)} | ${String(median).padStart(6)} | ${String(reach2048).padStart(4)} | ${distStr}`,
  );
}

// Kopyala-yapıştır için: ai.ts BOT_CHARACTER_STRENGTH bloğu
console.log('\n// src/app/logic/ai.ts — ölçülen güç (bu betiğin çıktısı):');
console.log('export const BOT_CHARACTER_STRENGTH: Record<BotCharacterId, CharacterStrength> = {');
for (const id of BOT_CHARACTER_IDS) {
  const r = report[id];
  console.log(
    `  ${id}: { avg: ${r.avg}, reach2048: ${r.reach2048}, peakTile: ${r.peakTile}, floorTile: ${r.floorTile} },`,
  );
}
console.log('};');
