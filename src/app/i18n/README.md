# Çeviriler (i18n)

Tüm arayüz + model metinleri **dil başına ayrı JSON** dosyalarında toplanır:

- `tr.json` — Türkçe (varsayılan dil, eksik anahtar yedeği)
- `en.json` — İngilizce

Anahtarlar **düz** (nokta ile gruplu): `btn.close`, `mp.title`, `ach.tile-512.name`.
Yer tutucular tek süslü parantez: `"Seviye {n} Tamamlandı!"` → `t('...', { n: 3 })`.

## Nasıl çalışır

- `I18nService` aktif dilin dosyasını **tembel** yükler (dynamic import → ayrı
  chunk); diğer diller ancak geçiş yapılınca iner. Bundan dolayı üçüncü bir dil
  eklemek herkese inmez — yalnızca o dili seçenlere.
- Uygulama açılışında `APP_INITIALIZER` aktif dili bootstrap **öncesi** yükler →
  ilk boyamada `t()` senkron ve doğrudur.
- Bir anahtar aktif dilde yoksa **varsayılan dile (tr)** düşer; o da yoksa
  anahtarın kendisi döner (çökme yok).
- Model metinleri (başarım/güç/tema/görev/ünvan) de bu dosyalardadır; modeller
  yalnızca `id` taşır, gösterim `t('ach.<id>.name')` gibi anahtarla yapılır.

## Yeni dil ekleme (örn. Almanca `de`)

1. **JSON dosyası:** `src/app/i18n/de.json` oluştur; `tr.json`'daki **tüm**
   anahtarları çevir (aynı anahtar seti şart — eksik olursa CI düşer).
2. **Dil listesi + yükleyici:** `src/app/services/i18n.service.ts`:
   - `Lang` tipine `'de'` ekle.
   - `LANGS` dizisine `'de'` ekle.
   - `LOADERS`'a satır ekle:
     `de: () => import('../i18n/de.json').then((m) => m.default as Dict),`
3. **Dil seçici UI:** Ayarlar panelindeki dil düğmelerine `de` ekle.
4. **Doğrula:** `node scripts/check-i18n.mjs` (diller arası eksik/fazla, ölü +
   tanımsız anahtar kontrolü — CI de bunu koşar).

## Bütünlük kontrolü

`node scripts/check-i18n.mjs` (npm: `npm run check:i18n`) üç şeyi denetler ve
sorun varsa çıkış kodu 1 verir (CI kapısı, `.github/workflows/ci.yml`):

1. **Diller arası parite** — her dilde aynı anahtar seti (eksik/fazla/boş yok).
2. **Ölü anahtar** — tanımlı ama kodda kullanılmayan.
3. **Tanımsız anahtar** — kodda `t('x')` ile çağrılan ama sözlükte olmayan.

## Metinleri yeniden üretmek

Eski tek-dosya `DICT` + model metinlerinden bu JSON'lar bir kez üretildi:
`node scripts/gen-i18n-locales.mjs` (artık kaynak JSON dosyalarıdır; betik
geçmiş/tekrar üretim içindir).
