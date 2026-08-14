// ============================================================
//  Günlük meydan okuma tohum takvimi üretici (gen-daily-calendar.mjs)
//
//  Motor İÇERİK KÜRATÖRÜ: her aday tohum için YZ paneli (easy..expert) o tohumun
//  taş dizisini oynar; ULAŞILABİLİR ORTALAMA SKOR ve DEĞİŞKENLİK (skill ödülü)
//  ölçülür. Ölçütleri geçen tohumlar bir TAKVİME yazılır (formül yerine takvim).
//
//  İyi günlük tohum:
//    • avg (panel ortalaması) yeterince yüksek  → cezalandırıcı değil, oynanabilir
//    • spread (expert − easy)  yeterince yüksek → iyi oynayan ödüllenir (yarış olur)
//
//  Belirleyicilik: takvim herkese aynı; istemci TS + sunucu JSON tek kaynaktan
//  yazılır (birebir). Takvim bitince istemci+sunucu FORMÜLE (FNV-1a) düşer.
//
//  Kullanım:
//    node scripts/gen-daily-calendar.mjs measure [K]   → dağılımı yazdır (eşik ayarı)
//    node scripts/gen-daily-calendar.mjs               → takvimi üret + yaz
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
const dir = mkdtempSync(join(tmpdir(), 'dailycal-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { playBotGameByKey } = await import(pathToFileURL(file).href);
unlinkSync(file);

// --- Değerlendirme ------------------------------------------
// Panel: farklı güçler AYNI tohumu (taş dizisi) oynar → skill farkı = değişkenlik.
const PANEL = ['easy', 'medium', 'hard', 'expert'];
// 3 dakikalık moda yakın hamle üst sınırı. Bot temposu 240-480ms → 180s'de
// ~375-750 hamle; skill farkı (değişkenlik) uzun oyunda ortaya çıkar.
const MAX_MOVES = 500;

// İYİ TOHUM EŞİKLERİ (measure moduyla 200 adayda kalibre edildi; 500 hamle):
//   avg dağılımı: min 5203 · p25 6833 · medyan 7300 → MIN_AVG düşük-tavanı eler.
//   spread dağılımı: min 120 · p25 4128 · medyan 5684 → MIN_SPREAD düz tohumu eler.
const MIN_AVG = 6000; // panel ortalaması: cezalandırıcı/düşük-tavan tohumları ele
const MIN_SPREAD = 4000; // expert − easy: skill ödüllensin, herkes aynı skoru almasın

function evaluateSeed(seed) {
  const scores = PANEL.map((lvl) => playBotGameByKey(seed, lvl, MAX_MOVES).finalScore);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const spread = Math.max(...scores) - Math.min(...scores);
  return { avg, spread, scores };
}

const isGood = (m) => m.avg >= MIN_AVG && m.spread >= MIN_SPREAD;

// Aday tohumlar: 1..K (deterministik, tekrar üretilebilir).
const mode = process.argv[2];

if (mode === 'measure') {
  const K = Number(process.argv[3] || 200);
  const avgs = [];
  const spreads = [];
  let good = 0;
  for (let seed = 1; seed <= K; seed++) {
    const m = evaluateSeed(seed);
    avgs.push(m.avg);
    spreads.push(m.spread);
    if (isGood(m)) good++;
  }
  const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(p * arr.length)];
  console.log(`\n${K} aday tohum ölçüldü (panel: ${PANEL.join(',')}, ${MAX_MOVES} hamle)\n`);
  console.log(
    `avg    → min ${Math.min(...avgs)} · p25 ${pct(avgs, 0.25)} · medyan ${pct(avgs, 0.5)} · p75 ${pct(avgs, 0.75)} · max ${Math.max(...avgs)}`,
  );
  console.log(
    `spread → min ${Math.min(...spreads)} · p25 ${pct(spreads, 0.25)} · medyan ${pct(spreads, 0.5)} · p75 ${pct(spreads, 0.75)} · max ${Math.max(...spreads)}`,
  );
  console.log(
    `\nEşik avg≥${MIN_AVG} & spread≥${MIN_SPREAD} → geçen: ${good}/${K} (%${Math.round((good / K) * 100)})`,
  );
  process.exit(0);
}

// --- Takvim üretimi -----------------------------------------
const NEED = 370; // ≥1 yıl (+ tampon)
const START_DAY = '2026-09-01'; // GELECEK: mevcut/geçmiş günler formülde kalır (bozulmaz)

const seeds = [];
const report = [];
let seed = 1;
while (seeds.length < NEED && seed < 200000) {
  const m = evaluateSeed(seed);
  if (isGood(m)) {
    seeds.push(seed);
    report.push({ seed, avg: m.avg, spread: m.spread });
  }
  seed++;
}

if (seeds.length < NEED) {
  console.error(`YETERSİZ: yalnızca ${seeds.length}/${NEED} uygun tohum bulundu (eşikleri gevşet)`);
  process.exit(1);
}

// İstemci TS + sunucu JSON — TEK kaynaktan, BİREBİR.
const tsHeader = `// OTOMATİK ÜRETİLDİ — scripts/gen-daily-calendar.mjs (elle düzenleme).
// YZ ile küratörlenmiş günlük tohum takvimi: her tohum ölçütleri sağlar
// (avg≥${MIN_AVG} & spread≥${MIN_SPREAD}). server/daily_calendar.json ile BİREBİR aynı
// (belirleyicilik). Takvim bitince istemci+sunucu FORMÜLE düşer.
export const DAILY_CALENDAR: { readonly startDay: string; readonly seeds: readonly number[] } = {
  startDay: '${START_DAY}',
  seeds: ${JSON.stringify(seeds)},
};
`;
writeFileSync(resolve(ROOT, 'src/app/logic/daily-calendar.data.ts'), tsHeader);
writeFileSync(
  resolve(ROOT, 'server/daily_calendar.json'),
  JSON.stringify({ startDay: START_DAY, seeds }, null, 0) + '\n',
);

// Rapor (ölçütlerin sağlandığı KANITI).
const avgAll = report.map((r) => r.avg);
const spreadAll = report.map((r) => r.spread);
const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
writeFileSync(
  resolve(ROOT, 'scripts/daily-calendar-report.txt'),
  `Günlük tohum takvimi raporu\n` +
    `Üretildi: ${seeds.length} tohum, başlangıç ${START_DAY} (≥1 yıl)\n` +
    `Eşik: avg≥${MIN_AVG} & spread≥${MIN_SPREAD} · panel ${PANEL.join(',')} · ${MAX_MOVES} hamle\n` +
    `Seçilen ort(avg)=${mean(avgAll)} · ort(spread)=${mean(spreadAll)}\n` +
    `min(avg)=${Math.min(...avgAll)} · min(spread)=${Math.min(...spreadAll)}\n` +
    `Denenen aday: ${seed - 1} · kabul oranı %${Math.round((seeds.length / (seed - 1)) * 100)}\n`,
);

console.log(`Yazıldı: src/app/logic/daily-calendar.data.ts + server/daily_calendar.json`);
console.log(`${seeds.length} küratörlü tohum (başlangıç ${START_DAY}); denenen aday ${seed - 1}`);
console.log(
  `Seçilen ort(avg)=${mean(avgAll)} · ort(spread)=${mean(spreadAll)} · min(avg)=${Math.min(...avgAll)} · min(spread)=${Math.min(...spreadAll)}`,
);
console.log('Tüm seçilen tohumlar ölçütleri sağlıyor ✓ (rapor: scripts/daily-calendar-report.txt)');
