# game2048 — NestJS + MongoDB backend (Python'dan geçiş)

Zeki Emre'nin Python (`../server/app.py`, stdlib `http.server` + `sqlite3`)
backend'inin **ekip standardına (NestJS + MongoDB)** taşınmış hâli. Davranış
**birebir korundu**; en değerli parça olan **skor doğrulaması (replay)** aynen
taşındı ve 150 fixture ile kanıtlandı.

> **Durum:** kod + testler tam ve yerelde yeşil (mongodb-memory-server, altyapısız).
> **Canlı devir** (gerçek veri göçü + trafik switch) ayrı ve elle onaylı bir
> adımdır — bkz. [docs/CUTOVER-ROLLBACK.md](docs/CUTOVER-ROLLBACK.md).

## Neden

Diğer dört oyun Node tabanlı; tek Python backend'in ayrı kalması ortak öğrenmeyi
ve bakımı zorlaştırıyordu. Bu paket onu NestJS'e taşır, **anti-cheat'i (sunucu
replay) kaybetmeden**.

## Mimari

```
src/
  replay/replay.ts          Skor doğrulama motoru (mulberry32/moveGrid/replayGame) — Python/istemci BİREBİR
  rooms/bot-ai.ts           Bot expectimax (bot_ai.py portu) — bot_fixtures ile birebir
  rooms/bot-timeline.service.ts  Sunucu bot skor çizelgesi (bellek, artımlı) — OYUN-311 botları
  auth/                     register/login/logout + PBKDF2 (600k, 120k legacy upgrade) + Bearer token
  users/                    /me, /sync (alan-bazlı merge_progress — kayıpsız bulut senkronu)
  scores/                   /monthly/*, /daily/*, /leaderboard + verify_transcript + flagged_submissions
  rooms/                    /rooms/* — OYUN-311: oda skoru SUNUCUDA replay ile doğrulanır (MAX-only)
  social/                   /friends/*, /messages/*, /report, /users/search
  schemas/                  Mongoose şemaları (users, sessions, scores, prizes, flags, rooms, friendships, messages, reports, counters)
  common/                   CORS + güvenlik başlıkları + yol ön-eki + hata zarfı + rate-limit + guard + counters
scripts/migrate-sqlite-to-mongo.ts   Kayıpsız + idempotent göç (node:sqlite → Mongo, dry-run destekli)
test/                       replay+bot paritesi, uçtan uca (e2e), göç testi
```

**Korunması şart olan davranışlar** (Python ile birebir): mulberry32 32-bit RNG
+ RNG çekim sırası, MAX-only skor yazımı, `score DESC, best DESC, updated ASC`
tie-break, PBKDF2 tur sayıları + legacy yükseltme, `merge_progress` birleştirme,
90 günlük token TTL, `{"error": "<code>"}` hata zarfı, günlük tohum (takvim→FNV).

## Uçlar (app.py ile birebir)

`GET /health` · `POST /register|/login|/logout` · `GET /me` · `POST /sync` ·
`GET /users/search` · `POST /friends/request|respond|remove` · `GET /friends` ·
`POST /messages` · `GET /messages|/messages/overview` · `POST /report` ·
`POST /rooms/create|join|leave|start|progress|addbot|removebot` · `GET /rooms/state` ·
`GET /leaderboard` · `POST /monthly/submit|claim` · `GET /daily` · `POST /daily/submit`

Başarılı yanıt her zaman **200**; hata gövdesi daima `{"error":"<code>"}`.

## Çalıştırma

```bash
npm install
# Mongo bağlantısı env'den (varsayılan mongodb://127.0.0.1:27017, db=game2048)
GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
GAME2048_PORT=8092 npm run start        # 127.0.0.1:8092 (nginx loopback'te fronter)
```

Env değişkenleri: `GAME2048_MONGO_URI`, `GAME2048_DB_NAME`, `GAME2048_PORT`
(vars. 8092), `GAME2048_CORS_ORIGINS` (virgülle; vars. canlı + localhost:4200).

## Testler (altyapısız — mongodb-memory-server)

```bash
npm test              # tüm suit: 212 test
npm run test:replay   # yalnız 150-fixture replay paritesi
```

- **replay paritesi** — 150 fixture, skor+maxTile Python/istemci ile birebir
- **bot paritesi** — `bot_fixtures.json` hamle+skor çizelgesi birebir
- **e2e** — auth, sync birleşme, **uydurma skor reddi**, leaderboard sıralaması,
  **OYUN-311** (oda skoru sunucuda doğrulanır, istemci skoru yok sayılır)
- **göç** — sqlite→Mongo kayıpsız + idempotent + sayaç bump

## Göç (sqlite → MongoDB)

```bash
# Önce KURU koşu (yazmaz, yalnız sayımları raporlar → öncesi/sonrası eşitliği):
GAME2048_DB=/home/emre/game2048-api/app.db \
GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
npm run migrate:dry
# Gerçek göç (idempotent — tekrar çalıştırılabilir, çoğaltmaz):
npm run migrate
```

Kullanıcı sayısal id'leri, friendships/messages/reports id'leri KORUNUR (dış
referanslar bunlara bağlı); `counters` koleksiyonu en büyük id'nin üstüne çekilir.

## Canlı devir & geri dönüş

Eski Python servisin yanında çalıştır, karşılaştır, sonra nginx'i çevir; sorun
olursa tek satırla geri dön. Adım adım runbook: **[docs/CUTOVER-ROLLBACK.md](docs/CUTOVER-ROLLBACK.md)**.
