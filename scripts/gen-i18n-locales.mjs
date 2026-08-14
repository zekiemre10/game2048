// ============================================================
//  i18n dil dosyası üretici (scripts/gen-i18n-locales.mjs)
//
//  TÜM çeviri metinlerini TEK sistemde toplar: eski i18n.service.ts DICT'i +
//  model dosyalarındaki (achievement/power/theme/mission/rank) iki-dilli
//  metinleri (name/nameEn/desc/descEn) → dil başına ayrı JSON:
//    src/app/i18n/tr.json · src/app/i18n/en.json
//
//  Model metinleri anahtarlanır: ach.<id>.name · power.<id>.desc · theme.<id>.name
//  · mission.<id>.desc · rank.<id>.name — böylece L(tr,en) deseni t(anahtar)'a döner.
//
//  Çalıştır:  node scripts/gen-i18n-locales.mjs
// ============================================================
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 1) Eski DICT'i i18n.service.ts kaynağından çıkar (Angular'ı çalıştırmadan).
const svc = readFileSync(resolve(ROOT, 'src/app/services/i18n.service.ts'), 'utf8');
const start = svc.indexOf('= {', svc.indexOf('const DICT'));
if (start < 0) throw new Error('DICT bulunamadı');
// `= {` sonrası eşleşen kapanış `}` (basit derinlik sayacı, string-içi süsleri say).
let i = start + 2;
let depth = 0;
let inStr = null;
let objEnd = -1;
for (; i < svc.length; i++) {
  const c = svc[i];
  if (inStr) {
    if (c === '\\') i++;
    else if (c === inStr) inStr = null;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') inStr = c;
  else if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) {
      objEnd = i + 1;
      break;
    }
  }
}
const objText = svc.slice(start + 2, objEnd);
// eslint-disable-next-line no-eval
const DICT = (0, eval)('(' + objText + ')');

// 2) Model dizilerini esbuild ile derleyip içe aktar (düz veri, Angular yok).
const entry = `
export { ACHIEVEMENTS } from '${resolve(ROOT, 'src/app/models/achievement.model.ts').replace(/\\/g, '/')}';
export { POWERS } from '${resolve(ROOT, 'src/app/models/power.model.ts').replace(/\\/g, '/')}';
export { THEMES } from '${resolve(ROOT, 'src/app/models/theme.model.ts').replace(/\\/g, '/')}';
export { DAILY_POOL, WEEKLY_POOL } from '${resolve(ROOT, 'src/app/models/mission.model.ts').replace(/\\/g, '/')}';
export { RANKS } from '${resolve(ROOT, 'src/app/logic/rank.ts').replace(/\\/g, '/')}';
`;
const out = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
});
const dir = mkdtempSync(join(tmpdir(), 'i18ngen-'));
const file = join(dir, 'models.mjs');
writeFileSync(file, out.outputFiles[0].text);
const models = await import(pathToFileURL(file).href);
unlinkSync(file);

const tr = {};
const en = {};
const put = (key, trText, enText) => {
  tr[key] = trText;
  en[key] = enText;
};

// Temel UI metinleri (eski DICT).
for (const [key, val] of Object.entries(DICT)) put(key, val.tr, val.en);

// Model metinleri (anahtarlanır).
for (const a of models.ACHIEVEMENTS) {
  put(`ach.${a.id}.name`, a.name, a.nameEn);
  put(`ach.${a.id}.desc`, a.desc, a.descEn);
}
for (const p of models.POWERS) {
  put(`power.${p.id}.name`, p.name, p.nameEn);
  put(`power.${p.id}.desc`, p.desc, p.descEn);
}
for (const th of models.THEMES) put(`theme.${th.id}.name`, th.name, th.nameEn);
for (const m of [...(models.DAILY_POOL || []), ...(models.WEEKLY_POOL || [])]) {
  put(`mission.${m.id}.desc`, m.desc, m.descEn);
}
for (const r of models.RANKS) put(`rank.${r.id}.name`, r.name, r.nameEn);

// Anahtarları sıralı yaz (diff dostu + kontrol kolay).
const sortObj = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

const destDir = resolve(ROOT, 'src/app/i18n');
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, 'tr.json'), JSON.stringify(sortObj(tr), null, 2) + '\n');
writeFileSync(join(destDir, 'en.json'), JSON.stringify(sortObj(en), null, 2) + '\n');

console.log(`Yazıldı: src/app/i18n/tr.json + en.json (${Object.keys(tr).length} anahtar)`);
console.log(
  `Model metinleri: ${models.ACHIEVEMENTS.length} başarım · ${models.POWERS.length} güç · ${models.THEMES.length} tema · ${(models.DAILY_POOL || []).length + (models.WEEKLY_POOL || []).length} görev · ${models.RANKS.length} ünvan`,
);
