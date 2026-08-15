// ============================================================
//  TypeScript replay motoru parite testi (server/replay.ts).
//
//  server/replay_fixtures.json içindeki transkriptler istemci mantığıyla
//  (scripts/gen-replay-fixtures.mjs) üretilmiştir. Sunucu replayGame HER
//  transkript için AYNI skor ve en büyük kareyi vermelidir — aksi hâlde
//  NestJS backend'i meşru oyunları reddeder (yanlış pozitif).
//
//  Altyapısız çalıştır (Node ≥ 22.6 --experimental-strip-types, ≥ 23.6 doğal):
//    node server/test_replay_parity.ts
//
//  Python eşi: python3 server/test_replay_parity.py (ikisi de geçmeli).
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { replayGame } from './replay.ts';

interface Fixture {
  seed: number;
  size: number;
  moves: string;
  score: number;
  maxTile: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'replay_fixtures.json');

function main(): void {
  const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES, 'utf-8'));

  let fails = 0;
  let longest = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i];
    const r = replayGame(fx.seed, fx.moves, fx.size);
    longest = Math.max(longest, fx.moves.length);
    if (!r.valid) {
      console.log(`  [${i}] GECERSIZ (beklenmedik): seed=${fx.seed}`);
      fails++;
      continue;
    }
    if (r.score !== fx.score) {
      console.log(
        `  [${i}] SKOR FARKI: ts=${r.score} != js=${fx.score} ` +
          `(seed=${fx.seed} size=${fx.size} moves=${fx.moves.length})`,
      );
      fails++;
    }
    if (r.maxTile !== fx.maxTile) {
      console.log(`  [${i}] MAXTILE FARKI: ts=${r.maxTile} != js=${fx.maxTile}`);
      fails++;
    }
  }

  const total = fixtures.length;
  if (fails) {
    console.log(`\n[X] PARITE BASARISIZ: ${fails} uyusmazlik / ${total} fixture`);
    process.exit(1);
  }
  console.log(
    `[OK] PARITE TAM: ${total} fixture, en uzun oyun ${longest} hamle - ` +
      `TypeScript (sunucu) replay = istemci mantigi (birebir)`,
  );
}

main();
