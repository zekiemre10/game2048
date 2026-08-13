// ============================================================
//  YZ kalibrasyon betiği (scripts/ai-calibrate.mjs)
//
//  Zorluk merdivenini 8k · 25k · 50k · 80k bandına oturtmak için sezgisel
//  parametreleri (derinlik, snakePow, emptyMul) TARAR. Gerçek motoru
//  (src/app/logic/ai.ts) esbuild ile derler; configureLevel ile seviye
//  ayarını çalışma anında değiştirip her kombinasyonu N oyunla ölçer.
//
//  Çalıştır:  node scripts/ai-calibrate.mjs [oyunSayisi]
// ============================================================
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function loadEngine() {
  const out = await build({
    entryPoints: [resolve(ROOT, 'src/app/logic/ai.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  });
  const dir = mkdtempSync(join(tmpdir(), 'aical-'));
  const file = join(dir, 'ai.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  unlinkSync(file);
  return mod;
}

function playGame(engine, level, rng) {
  const { bestMove, simulateMove, emptyCells, placeTile } = engine;
  let g = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const spawn = () => {
    const cells = emptyCells(g);
    if (!cells.length) return;
    const [r, c] = cells[Math.floor(rng() * cells.length)];
    g = placeTile(g, r, c, rng() < 0.1 ? 4 : 2);
  };
  spawn();
  spawn();
  let score = 0,
    maxTile = 0;
  for (let step = 0; step < 20000; step++) {
    const dir = bestMove(g, level);
    if (!dir) break;
    const res = simulateMove(g, dir);
    if (!res.moved) break;
    g = res.grid;
    score += res.gained;
    spawn();
  }
  for (const row of g) for (const v of row) if (v > maxTile) maxTile = v;
  return { score, maxTile };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

async function measure(engine, patch, N, seeds) {
  // 'hard' slotunu geçici ayar taşıyıcısı olarak kullan (d2 tabanlı taramalar).
  engine.configureLevel('hard', patch);
  const scores = [],
    tiles = [];
  for (let i = 0; i < N; i++) {
    const r = playGame(engine, 'hard', engine.mulberry32(seeds[i]));
    scores.push(r.score);
    tiles.push(r.maxTile);
  }
  const reach = (tiles.filter((t) => t >= 2048).length / N) * 100;
  return { avg: Math.round(mean(scores)), reach };
}

async function main() {
  const N = Number(process.argv[2] || 12);
  const engine = await loadEngine();
  const seeds = Array.from({ length: N }, (_, i) => (0x1234 + i * 2654435761) >>> 0);

  // Deterministik knoblar (RASTGELE HAMLE YOK):
  //   depth   — lookahead (baskın lever: d1~3k çöker, d2~20-33k)
  //   sampleK — şans düğümü örnekleme genişliği (1 = kaba beklenen değer = zayıf)
  //   snakePow/emptyMul — sezgisel güç (köşe disiplini + hayatta kalma)
  // Aradaki 8k bandını d2 + düşük sampleK ile doldurmayı hedefliyoruz.
  const combos = [
    // easy adayları (d2 kaba/zayıf): 8k civarı aranıyor
    { minDepth: 2, maxDepth: 2, sampleK: 1, expandFour: false, snakePow: 0.3, emptyMul: 1 },
    { minDepth: 2, maxDepth: 2, sampleK: 1, expandFour: false, snakePow: 0.5, emptyMul: 1 },
    { minDepth: 2, maxDepth: 2, sampleK: 1, expandFour: false, snakePow: 1.0, emptyMul: 2 },
    { minDepth: 2, maxDepth: 2, sampleK: 1, expandFour: true, snakePow: 0.3, emptyMul: 1 },
    { minDepth: 1, maxDepth: 1, sampleK: 3, expandFour: true, snakePow: 1.0, emptyMul: 8 },
    // medium adayları (d2 zayıf sezgisel): 20-25k
    { minDepth: 2, maxDepth: 2, sampleK: 2, expandFour: true, snakePow: 0.3, emptyMul: 1 },
    { minDepth: 2, maxDepth: 2, sampleK: 2, expandFour: true, snakePow: 0.5, emptyMul: 2 },
    { minDepth: 2, maxDepth: 2, sampleK: 2, expandFour: true, snakePow: 0.75, emptyMul: 4 },
    // hard adayı (d2 tam sezgisel): ~33-40k
    { minDepth: 2, maxDepth: 2, sampleK: 3, expandFour: true, snakePow: 1.0, emptyMul: 4 },
  ];

  console.log(`\nKALİBRASYON TARAMASI — seviye başına ${N} oyun\n`);
  console.log('depth | sK | e4 | snakePow | emptyMul | ort.skor | 2048%');
  console.log('-'.repeat(62));
  for (const c of combos) {
    const patch = { ...c, timeCapMs: 20 };
    const r = await measure(engine, patch, N, seeds);
    console.log(
      `  ${c.minDepth}   | ${c.sampleK}  | ${c.expandFour ? 'E' : '-'}  |   ${c.snakePow.toFixed(2)}   ` +
        `|    ${String(c.emptyMul).padStart(2)}    | ${String(r.avg).padStart(8)} | ${r.reach.toFixed(0).padStart(3)}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
