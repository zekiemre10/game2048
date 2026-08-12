// ============================================================
//  Ölü çeviri anahtarı kontrolü (scripts/check-i18n.mjs)
//
//  i18n sözlüğünde (DICT) TANIMLI ama kod tabanında HİÇBİR YERDE kullanılmayan
//  çeviri anahtarlarını bulur. Kullanım hem düz metin (t('key')), hem de DİNAMİK
//  kurulum (t(`prefix.${x}`) veya t('prefix.' + x)) olarak algılanır → dinamik
//  anahtarlar yanlışlıkla "ölü" işaretlenmez.
//
//  Ölü anahtar bulunursa çıkış kodu 1 (CI'yı düşürür) — ileride ölü anahtar
//  birikmesin. Çalıştır:  node scripts/check-i18n.mjs
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const I18N = join(SRC, 'app/services/i18n.service.ts');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.html'].includes(extname(p))) out.push(p);
  }
  return out;
}

// 1) Tanımlı anahtarlar (DICT: 'key': { tr:…, en:… })
const i18nText = readFileSync(I18N, 'utf8');
const defined = [...i18nText.matchAll(/^\s*'([^']+)':\s*\{/gm)].map((m) => m[1]);

// 2) Kullanım metni — TÜM kaynak dosyalar; i18n.service.ts'te anahtar TANIM
//    satırları çıkarılır (tanımın kendisi "kullanım" sayılmasın).
let corpus = '';
for (const f of walk(SRC)) {
  let text = readFileSync(f, 'utf8');
  if (f === I18N) {
    text = text.split('\n').filter((l) => !/^\s*'[^']+':\s*\{/.test(l)).join('\n');
  }
  corpus += '\n' + text;
}

// 3) Dinamik önekler: t(`prefix.${…}`) ve t('prefix.' + …) / 'prefix' + …
const prefixes = new Set();
for (const m of corpus.matchAll(/`([\w.]+)\$\{/g)) prefixes.add(m[1]);
for (const m of corpus.matchAll(/['"]([\w.]+)['"]\s*\+/g)) prefixes.add(m[1]);

function isUsed(key) {
  if (corpus.includes(`'${key}'`) || corpus.includes(`"${key}"`) || corpus.includes('`' + key + '`')) {
    return true;
  }
  for (const p of prefixes) if (key.startsWith(p)) return true;
  return false;
}

const dead = defined.filter((k) => !isUsed(k));

if (dead.length) {
  console.error(`✗ Kullanılmayan ${dead.length} çeviri anahtarı (kaldırın veya kullanın):`);
  for (const k of dead) console.error('   - ' + k);
  process.exit(1);
}
console.log(`✓ Tüm ${defined.length} çeviri anahtarı kullanımda — ölü anahtar yok.`);
