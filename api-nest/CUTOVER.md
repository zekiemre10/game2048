# game2048 — Python → NestJS canlı devir (cutover) + geri dönüş planı

Kod + testler hazır (`api-nest/`, 212 test / 4 suite; 150-fixture replay paritesi;
sqlite→Mongo göç betiği + `migration.spec.ts` kayıpsızlığı kanıtlar). Bu belge
canlı servisi **güvenle** Python'dan NestJS'e almanın adımlarıdır.

## Neden güvenli

- **Göç betiği sqlite'ı YALNIZCA OKUR** (`app.db` değişmez) → geri dönüş her an
  kayıpsız: Python'u geri başlatmak yeter.
- **İki servis de 8092 portunu** kullanır (varsayılan) → nginx `/api → 127.0.0.1:8092`
  proxy'si **değişmez**; devir = 8092'yi hangi servisin dinlediğini değiştirmek.
- Göç **idempotent / tekrar çalıştırılabilir** (`--dry-run` sayım karşılaştırır).

## Ön koşullar (sunucuda)

```bash
# 1) MongoDB kurulu + çalışıyor (yerel ör.)
mongod --version && systemctl is-active mongod
# 2) NestJS derle
cd /opt/game2048-api-nest && npm ci && npm run build   # dist/ üretir
```
Env (systemd `Environment=` ya da kabuk):
`GAME2048_MONGO_URI=mongodb://127.0.0.1:27017` · `GAME2048_DB_NAME=game2048`
· `GAME2048_DB=/var/lib/game2048-api/app.db` · `GAME2048_PORT=8092`

## Aşama 1 — Göçü PROVA et (yazmadan)

```bash
GAME2048_DB=/var/lib/game2048-api/app.db \
GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
  node scripts/migrate-sqlite-to-mongo.ts --dry-run
```
Çıktı tablo başına sqlite sayımını verir. Not al (kullanıcılar, aylık/günlük
skorlar, rozet/ödül, flagged).

## Aşama 2 — Yan yana çalıştır + KARŞILAŞTIR

NestJS'i **farklı portta** (8093) kaldır; Python 8092'de kalsın. Gerçek göçü koş:
```bash
# gerçek göç (Mongo'ya yazar; app.db'ye DOKUNMAZ)
GAME2048_DB=/var/lib/game2048-api/app.db GAME2048_MONGO_URI=... GAME2048_DB_NAME=game2048 \
  node scripts/migrate-sqlite-to-mongo.ts        # sonda sqlite==mongo sayımları eşleşmeli (mismatch 0)
# NestJS'i 8093'te başlat
GAME2048_PORT=8093 GAME2048_MONGO_URI=... node dist/main.js &
```
Duman testi — iki portu KARŞILAŞTIR (aynı yanıt beklenir):
```bash
for P in 8092 8093; do echo "== :$P =="; curl -s 127.0.0.1:$P/health; \
  curl -s "127.0.0.1:$P/leaderboard?scope=monthly" | head -c 300; echo; done
# giriş + skor gönderimi (meşru kabul / uydurma 400) + oda ilerlemesi elle kontrol
```

## Aşama 3 — Devir (kısa bakım penceresi)

```bash
sudo systemctl stop game2048-api                 # Python'u durdur (8092 boşalır)
# son idempotent göç: durdurduktan sonra sqlite'taki en güncel yazmaları al
GAME2048_DB=/var/lib/game2048-api/app.db GAME2048_MONGO_URI=... GAME2048_DB_NAME=game2048 \
  node scripts/migrate-sqlite-to-mongo.ts
sudo systemctl start game2048-api-nest           # NestJS'i 8092'de başlat
curl -fsS http://127.0.0.1:8092/health           # {"ok":true}
```
nginx değişmez (hâlâ 8092). `game2048-api-nest.service` = `dist/main.js`'i
`GAME2048_PORT=8092` + Mongo env ile çalıştıran systemd birimi (Python birimiyle
aynı kalıp; `Restart=on-failure`).

## Geri dönüş (rollback) — her an, kayıpsız

```bash
sudo systemctl stop game2048-api-nest
sudo systemctl start game2048-api                # Python 8092'de geri döner
curl -fsS http://127.0.0.1:8092/health
```
`app.db` göç boyunca değişmedi → **devir anına kadarki tüm veri Python'da sağlam.**
(Devirden sonra NestJS'te oluşan YENİ yazmalar rollback'te geride kalır; bu yüzden
devir sonrası kısa bir gözlem penceresinde sorun çıkarsa hemen dön.)

## Devir sonrası

- Python `game2048-api` servisini **silme**, sadece durdur/disable et; `app.db`'yi
  ve son yedeği (`/var/backups/game2048-api/`) en az birkaç gün **sakla** (rollback).
- NestJS loglarını + `/health` timer'ını izle. Güven oluşunca Python'u kaldır.

## Kabul kriterleri ↔ durum

- [x] Tüm uçlar NestJS'te, eski davranışla aynı — `api.e2e.spec.ts` (kod hazır)
- [x] 150-fixture replay paritesi geçiyor — `replay.parity.spec.ts`
- [x] Kayıpsız göç (sayılar öncesi/sonrası eşit) — `migration.spec.ts` (mismatch 0)
- [x] Uydurma skor reddediliyor — `scores`/`rooms` verify + testler
- [x] Testler + CI yeşil — 212 test; `nest-backend` job (ubuntu-22.04)
- [ ] **Canlı devir** — sunucu erişimi + MongoDB gerekli; bu runbook'la yürütülür
