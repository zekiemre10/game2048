// ============================================================
//  Bot parite fixture üretici (scripts/gen-bot-fixtures.mjs)
//
//  Gerçek TS bot motorunu (src/app/logic/ai.ts) esbuild ile derleyip birkaç
//  (tohum × seviye) için deterministik bot oyununu oynatır ve sonucu
//  server/bot_fixtures.json'a yazar. server/test_bot_parity.py bu fixture'ları
//  Python bot motoruyla (bot_ai.py) yeniden oynatıp BİREBİR aynı olduğunu
//  doğrular (aynı tohum → aynı hamleler → aynı skor çizelgesi).
//
//  Çalıştır:  node scripts/gen-bot-fixtures.mjs
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
const dir = mkdtempSync(join(tmpdir(), 'botfix-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { playBotGameByKey, BOT_CHARACTER_IDS } = await import(pathToFileURL(file).href);
unlinkSync(file);

const SEEDS = [1, 2, 3, 42, 1000, 123456];
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
// Parite hem zorluk kademelerini hem BOT KARAKTERLERİni kapsar (ikisi de aynı
// motoru farklı ağırlık setiyle besler; ikisi de TS↔Python birebir olmalı).
const KEYS = [...LEVELS, ...BOT_CHARACTER_IDS];
const MAX_MOVES = 600; // parite için bol; expert d3 JS'te hızlı

const fixtures = [];
for (const key of KEYS) {
  for (const seed of SEEDS) {
    const g = playBotGameByKey(seed, key, MAX_MOVES);
    fixtures.push({
      seed,
      key, // zorluk kademesi VEYA karakter kimliği
      maxMoves: MAX_MOVES,
      moves: g.moves,
      scores: g.scores,
      bests: g.bests,
      maxTile: g.maxTile,
      finalScore: g.finalScore,
    });
  }
}

const path = resolve(ROOT, 'server/bot_fixtures.json');
writeFileSync(
  path,
  JSON.stringify({ generated: 'gen-bot-fixtures.mjs', maxMoves: MAX_MOVES, fixtures }, null, 0),
);
console.log(`Yazıldı: ${path}`);
console.log(`${fixtures.length} fixture (${KEYS.length} anahtar × ${SEEDS.length} tohum)`);
for (const f of fixtures)
  console.log(
    `  ${f.key.padEnd(9)} tohum ${String(f.seed).padStart(6)}: ${f.moves.length} hamle, skor ${f.finalScore}, en büyük ${f.maxTile}`,
  );
