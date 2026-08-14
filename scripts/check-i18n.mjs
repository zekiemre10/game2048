// ============================================================
//  i18n bütünlük kontrolü (scripts/check-i18n.mjs) — CI kapısı
//
//  Dil dosyaları src/app/i18n/<lang>.json. Üç kontrol:
//    1) DİLLER ARASI PARİTE — her dilde AYNI anahtar seti (eksik/fazla yok).
//    2) ÖLÜ ANAHTAR — tanımlı ama kod tabanında hiç kullanılmayan anahtar.
//    3) TANIMSIZ ANAHTAR — kodda düz metin t('x') ile kullanılan ama tanımsız.
//
//  Kullanım (dinamik anahtarlar): t(`prefix.${x}`) / t('prefix.' + x) önekleri
//  algılanır → model anahtarları (ach.<id>.name gibi) yanlışlıkla ölü sayılmaz.
//
//  Herhangi bir sorunda çıkış kodu 1 (CI'yı düşürür).
//  Çalıştır:  node scripts/check-i18n.mjs
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const I18N_DIR = join(SRC, 'app/i18n');

// --- 1) Dil dosyalarını yükle -------------------------------
const langFiles = readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'));
if (langFiles.length < 1) {
  console.error('✗ src/app/i18n/ altında dil dosyası yok.');
  process.exit(1);
}
const langs = {};
for (const f of langFiles) {
  langs[basename(f, '.json')] = JSON.parse(readFileSync(join(I18N_DIR, f), 'utf8'));
}
const langNames = Object.keys(langs);

const problems = [];

// --- 2) Diller arası parite (eksik/fazla anahtar) -----------
const allKeys = new Set();
for (const l of langNames) for (const k of Object.keys(langs[l])) allKeys.add(k);
for (const l of langNames) {
  const have = new Set(Object.keys(langs[l]));
  const missing = [...allKeys].filter((k) => !have.has(k));
  if (missing.length) {
    problems.push(
      `'${l}' dilinde EKSİK ${missing.length} anahtar: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`,
    );
  }
  // Boş değer de eksiktir.
  const empty = [...have].filter((k) => !String(langs[l][k]).trim());
  if (empty.length) {
    problems.push(
      `'${l}' dilinde BOŞ ${empty.length} değer: ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? '…' : ''}`,
    );
  }
}

// --- Kod tabanı metni (dinamik önekler dahil) ---------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.html'].includes(extname(p))) out.push(p);
  }
  return out;
}
let corpus = '';
for (const f of walk(SRC)) {
  if (f.endsWith('.spec.ts')) continue; // testlerdeki örnek anahtarlar sayılmasın
  corpus += '\n' + readFileSync(f, 'utf8');
}

// Dinamik önekler: t(`prefix.${…}`) ve t('prefix.' + …)
const prefixes = new Set();
for (const m of corpus.matchAll(/`([\w.]+)\$\{/g)) prefixes.add(m[1]);
for (const m of corpus.matchAll(/['"]([\w.]+)['"]\s*\+/g)) prefixes.add(m[1]);

const usedByPrefix = (key) => [...prefixes].some((p) => key.startsWith(p));
const usedLiteral = (key) =>
  corpus.includes(`'${key}'`) || corpus.includes(`"${key}"`) || corpus.includes('`' + key + '`');

// --- 3) Ölü anahtar (tanımlı ama kullanılmayan) -------------
const dead = [...allKeys].filter((k) => !usedLiteral(k) && !usedByPrefix(k));
if (dead.length) {
  problems.push(
    `Kullanılmayan ${dead.length} anahtar (kaldırın veya kullanın): ${dead.join(', ')}`,
  );
}

// --- 4) Tanımsız anahtar (düz metin t('x') ama tanımsız) ----
// Yalnızca düz metin t('...') / t("...") çağrıları; dinamik (şablon/birleştirme) atlanır.
// Anahtar TAM argüman olmalı: kapanış tırnağından sonra `)` veya `,` gelmeli
// (birleştirme `'prefix.' +` ile başlayan dinamik anahtarlar HARİÇ tutulur).
const undefinedKeys = new Set();
for (const m of corpus.matchAll(/\bt\(\s*['"]([\w.]+)['"]\s*[),]/g)) {
  const key = m[1];
  if (!allKeys.has(key)) undefinedKeys.add(key);
}
if (undefinedKeys.size) {
  problems.push(
    `Tanımsız ${undefinedKeys.size} anahtar (kodda kullanılıyor, sözlükte yok): ${[...undefinedKeys].join(', ')}`,
  );
}

// --- Sonuç --------------------------------------------------
if (problems.length) {
  console.error('✗ i18n bütünlük sorunları:');
  for (const p of problems) console.error('   - ' + p);
  process.exit(1);
}
const n = allKeys.size;
console.log(
  `✓ i18n bütünlük TAM — ${langNames.length} dil (${langNames.join(', ')}), ${n} anahtar; eksik/fazla/ölü/tanımsız yok.`,
);
