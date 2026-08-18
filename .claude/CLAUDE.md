# 2048 — proje bağlamı (Claude Code)

Angular 22 + Python stdlib bir 2048 oyunu. Bu dosya her oturumda sıfırdan
anlatmayı bitirir: mimari, kod stili, sık komutlar, dağıtım.

## Ne / nerede

- **Frontend:** Angular 22 **standalone** bileşenler + **signals** + `inject()`.
  Şablonda `@if`/`@for`. Stil SCSS. Kaynak `src/app/`. İki dil (TR+EN) `src/app/i18n/`.
- **Backend:** saf **Python stdlib** (`http.server` + `sqlite3` + PBKDF2), bağımlılık
  YOK. `server/app.py` + yardımcı modüller (`replay`, `bot_ai`, `score_audit`,
  `metrics`, `monitor`, `econ`). Servis `game2048-api`, port **8092**.
- **Canlı:** `https://2048.aicirkit.com/` (alan adı KÖKÜNDE, base href `/`,
  same-origin `/api`). Sunucu `emre@34.158.136.9`, DB `/home/emre/game2048-api/app.db`.
- **Depo:** monorepo `emre/` içindeki `game2048/`, `zekiemre10/game2048`'e
  `git subtree` ile push'lanır.

## Kod stili

- TR yorum + TR commit (ASCII: ş→s, ç→c…). Değişken/fonksiyon adları İngilizce.
- **Her yeni UI metni iki dilde** (`i18n/tr.json` + `en.json`); `check:i18n` kapısı
  ölü/tanımsız/eksik anahtarı reddeder. Prettier zorunlu (`format:check`).
- **Tasarım sistemden türetilir** (bkz. `design-system/` + `docs/tasarim-sistemi.md`),
  sıfırdan uydurma. Renk/kare/tipografi tokenları `src/styles/_variables.scss` +
  `_base.scss` (6 tema).
- Yapısal borç: `app.scss`/`app.html` monolit (OYUN-236 böler). Yeni iş tek dosyaya
  yığma; bileşene ayır.

## Sık komutlar

```bash
npm start                 # ng serve (localhost:4200)
npm run build             # üretim derlemesi → dist/game2048/browser
npm test                  # frontend birim (vitest)
npm run check:i18n        # i18n bütünlük kapısı
npm run format            # prettier yaz
python server/run_tests.py   # backend testleri (stdlib, izole)
```

## Dağıtım (SSH anahtarı yetkili)

- **Backend:** `scp server/app.py <modüller> emre@34.158.136.9:/home/emre/game2048-api/`
  → `python3 -m py_compile` → `echo 'Emre2026!' | sudo -S systemctl restart game2048-api`.
  ⚠️ app.py YENİ `import x` yaparsa `x.py` ONUNLA birlikte gönderilmeli (yoksa çöker).
- **Frontend:** PowerShell `ng build` → `tar` → scp → `/var/www/emre/2048` **dizin
  takası** (`mv 2048 2048_old; mv stage 2048; chmod -R a+rX`) — sudosuz.
- **Push:** `git push origin main` **VE** `git subtree push --prefix=game2048 game2048 main`.
- Commit sonu: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## CI kapıları (`.github/workflows/ci.yml`, subtree repoda koşar)

`check:i18n` · `format:check` · `npm test` · `build` · `python server/run_tests.py`
· e2e (Playwright). **Not:** tarayıcı-yan servisler (telemetri, ayar okuma)
jsdom'da `fetch`/`sendBeacon` yapmamalı → birim testleri takılır (geçmiş hata).

## Yönetim (admin) API yüzeyi

Yönetim KODU oyun paketinde YOK; yalnız rol-korumalı `/admin/*` API (ayrı yönetici
uygulaması tüketir). Yetenekler: sohbet moderasyonu, skor moderasyonu, metrik
panosu, kullanıcı yönetimi, oda/sunucu izleme, ekonomi ayarları. Bkz. `server/ADMIN.md`.
Gizlilik: `PRIVACY.md` (kod = politika).
