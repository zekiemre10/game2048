// ============================================================
//  Uyarlanabilir zorluk merdiveni ölçümü (scripts/adaptive-ladder-bench.mjs)
//
//  "Bana uygun rakip" eşleştirmesi, ÖLÇÜLEN skoru hedefe en yakın rung'ı seçer.
//  Bu betik adayı rung anahtarlarını (zorluk kademeleri + karakterler) gerçek
//  yarış yolunda (playBotGame, 4×4) N oyunda ölçer ve ort. skoru sıralı yazar →
//  ai.ts ADAPTIVE_LADDER verisini besler.
//
//  Çalıştır:  node scripts/adaptive-ladder-bench.mjs [oyunSayisi]
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
const dir = mkdtempSync(join(tmpdir(), 'ladderbench-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { playBotGameByKey } = await import(pathToFileURL(file).href);
unlinkSync(file);

const N = Number(process.argv[2] || 40);
const MAX_MOVES = 20000;
// Aday rung'lar: mevcut kademeler + karakterler (hepsi sunucuda çözülebilir +
// parite fixture'larında). Ölçüp sıralayınca merdiven çıkar.
const KEYS = ['easy', 'medium', 'hard', 'expert', 'hasty', 'space', 'balanced', 'corner'];
const seeds = Array.from({ length: N }, (_, i) => (0x1234 + i * 2654435761) >>> 0);

const rows = [];
for (const key of KEYS) {
  const scores = seeds.map((s) => playBotGameByKey(s, key, MAX_MOVES).finalScore);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / N);
  rows.push({ key, avg });
}
rows.sort((a, b) => a.avg - b.avg);

console.log(`\nUyarlanabilir merdiven — ${N} oyun/rung (playBotGame, 4×4), artan güç:\n`);
console.log('Rung      | Ort.skor | Önceki kademeye oran');
console.log('-'.repeat(48));
let prev = 0;
for (const r of rows) {
  const ratio = prev ? (r.avg / prev).toFixed(1) + '×' : '—';
  console.log(`${r.key.padEnd(9)} | ${String(r.avg).padStart(8)} | ${ratio}`);
  prev = r.avg;
}
console.log('\n// ai.ts ADAPTIVE_LADDER (artan güç):');
console.log(
  'export const ADAPTIVE_LADDER = [\n' +
    rows.map((r) => `  { key: '${r.key}', avg: ${r.avg} },`).join('\n') +
    '\n];',
);
