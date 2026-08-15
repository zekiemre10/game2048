# Canlı devir (cutover) & geri dönüş (rollback) runbook

game2048 backend'ini **Python (sqlite)** → **NestJS (MongoDB)** canlıya alma
planı. İlke: **yeni servisi eskinin YANINDA çalıştır, karşılaştır, sonra çevir;
sorun olursa tek adımda geri dön.** Eski servis ve DB göç boyunca DOKUNULMADAN
kalır → geri dönüş anında ve kayıpsızdır.

> Bu doküman prosedürdür; komutları **sunucu sahibi** onaylı bir bakım
> penceresinde çalıştırır. Hiçbir adım burada otomatik tetiklenmez.

## Ön koşullar

- Sunucuda MongoDB erişilebilir (yerel `mongodb://127.0.0.1:27017` veya ekip cluster'ı).
- Node 24 (yerleşik `node:sqlite` göç betiği için).
- Eski servis: `game2048-api` (systemd), port **8092**, DB `/home/emre/game2048-api/app.db`.
- nginx: `2048.aicirkit.com` `location /api/` → `127.0.0.1:8092` (bkz. `deploy/nginx`).

## Aşama 0 — Hazırlık (canlıya dokunmaz)

```bash
cd game2048/api-nest && npm ci && npm run build && npm test   # hepsi yeşil olmalı
```

## Aşama 1 — Yeni servisi FARKLI portta ayağa kaldır (8093)

Eski servis 8092'de çalışmaya devam eder; yeni servis 8093'te **paralel** koşar.

```bash
GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
GAME2048_PORT=8093 GAME2048_CORS_ORIGINS=https://2048.aicirkit.com \
node dist/main.js
# (kalıcı için systemd birimi: game2048-api-nest.service, WantedBy multi-user)
```

## Aşama 2 — Veriyi göç et (KURU koşu önce)

```bash
# 1) KURU koşu — hiçbir şey yazmaz, sadece tablo sayımlarını raporlar:
GAME2048_DB=/home/emre/game2048-api/app.db \
GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
npm run migrate:dry
# 2) Gerçek göç (idempotent). Çıktı sqlite==mongo sayılarını gösterir:
npm run migrate
```

Göç betiği **tekrar çalıştırılabilir**: kısa bir "dondurma" (eski servisi
durdur → son göç → çevir) ile son yazımlar da taşınır. Kullanıcı/skor/rozet
(rozetler `users.data` içinde) sayıları öncesi = sonrası olmalı.

## Aşama 3 — Gölge karşılaştırma (paralel doğrulama)

Aynı token ile iki servise de sorup yanıtları karşılaştır (kritik uçlar):

```bash
TOKEN=... # geçerli bir kullanıcı token'ı
for p in "/leaderboard?scope=monthly" "/daily" "/me"; do
  diff <(curl -s -H "Authorization: Bearer $TOKEN" localhost:8092$p) \
       <(curl -s -H "Authorization: Bearer $TOKEN" localhost:8093$p) \
    && echo "OK  $p" || echo "FARK $p"
done
```

`/monthly/submit` ve `/rooms/progress` için aynı transkripti iki servise gönder;
**sunucu-hesaplı skor** birebir aynı olmalı (replay paritesi bunu garanti eder).

## Aşama 4 — Çevir (nginx upstream 8092 → 8093)

```bash
# Kısa dondurma: son yazımları da taşı, sonra çevir.
sudo systemctl stop game2048-api          # eski servis (yazımlar durur)
npm run migrate                           # son delta (idempotent)
# nginx: 2048 bloğunda proxy_pass 127.0.0.1:8092 → 127.0.0.1:8093
sudo sed -i 's/127.0.0.1:8092/127.0.0.1:8093/' /etc/nginx/sites-available/aicirkit-games
sudo nginx -t && sudo systemctl reload nginx
```

Duman testi: `curl -s https://2048.aicirkit.com/api/leaderboard` → 200 JSON;
tarayıcıda giriş/skor/oda akışı çalışıyor mu?

## Geri dönüş (rollback) — tek adım

Herhangi bir sorunda **anında** eskiye dön (eski servis + sqlite hiç değişmedi):

```bash
sudo sed -i 's/127.0.0.1:8093/127.0.0.1:8092/' /etc/nginx/sites-available/aicirkit-games
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl start game2048-api          # eski Python servisi geri
```

Devir sonrası eskiye dönersen, **yeni serviste (Mongo'da) biriken yazımlar**
sqlite'a otomatik geri taşınmaz. Bu yüzden çevirmeden önce Aşama 3 doğrulaması
ve kısa dondurma önemlidir. İlk 24–48 saat eski servisi + sqlite'ı **silme**,
yalnızca durdur (hızlı geri dönüş güvencesi).

## Devir sonrası temizlik (güven oturunca)

- `game2048-api` (Python) birimini devre dışı bırak: `sudo systemctl disable game2048-api`.
- sqlite yedeğini arşivle (silme; kanıt/again).
- İzleme: hata oranı, `flagged_submissions` artışı (anti-cheat hâlâ çalışıyor mu),
  gecikme. Bir hafta stabilse Python backend kaldırılabilir.

## Kontrol listesi (kabul kriterleri)

- [ ] Tüm uçlar NestJS'te, eski davranışla aynı yanıt (Aşama 3 diff temiz)
- [ ] 150 fixture replay paritesi yeşil (`npm run test:replay`)
- [ ] Kullanıcı/skor/rozet sayıları öncesi = sonrası (`npm run migrate` çıktısı)
- [ ] Uydurma skor hâlâ reddediliyor (e2e testinde kanıtlı; canlıda spot-check)
- [ ] Testler + CI yeşil
- [ ] Geri dönüş provası yapıldı (nginx çevir-geri-çevir, 8092↔8093)
