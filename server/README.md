# 2048 — Backend (`server/`)

Çevrimiçi özelliklerin (hesap, senkron, skor doğrulama, arkadaş/sohbet, çok
oyunculu yarış, YZ koç) tamamını sunan küçük servis. **Python stdlib** ile
yazılı — `http.server` + `sqlite3` + `hashlib` (PBKDF2). **Harici bağımlılık
yok**, paket kurmadan çalışır.

- Dinleme: `127.0.0.1:8092` (nginx `/api`'yi buraya proxy'ler)
- Veri: tek dosya SQLite (`app.db`) — tablolar ilk açılışta kurulur
- Skor **sunucuda** hesaplanır (tohum + hamle → replay) → istemci skoruna güvenilmez
- Bot rakip **sunucuda** koşar (adil, manipüle edilemez)

> Üretim (systemd, nginx, otomatik yedek/geri yükleme, bakım, sağlık kontrolü):
> bkz. [`deploy/README.md`](deploy/README.md). Bu dosya **geliştirme + uç nokta
> referansı**dır.

## Hızlı çalıştır (yerel)

Bağımlılık kurmak gerekmez.

```bash
# Windows'ta 'py', Linux/mac'te 'python3'
py server/app.py            # 127.0.0.1:8092 dinler; app.db aynı klasörde
```

Geçici DB ile denemek (üretim verisine dokunmadan):

```bash
GAME2048_DB=/tmp/dev.db py server/app.py
curl -fsS http://127.0.0.1:8092/health          # {"ok": true}
```

> **Not (dev):** `ng serve` (localhost) istemcisi varsayılan olarak **canlı**
> backend'e (`https://2048.aicirkit.com/api`) konuşur (bkz. `auth.service.ts`
> `DEV_API_BASE`). Tamamen yerel çalışmak istersen backend'i yukarıdaki gibi
> ayağa kaldırıp o sabiti geçici olarak `http://localhost:8092`'ye çevir.

## Ortam değişkenleri

| Değişken | Varsayılan | Ne işe yarar |
|----------|-----------|--------------|
| `GAME2048_DB` | `server/app.db` | SQLite dosya yolu (üretimde kod dizini DIŞINDA tut) |
| `GAME2048_PORT` | `8092` | Dinleme portu |
| `GAME2048_CORS_ORIGINS` | (yok) | İzinli origin listesi (virgülle); dağıtımda same-origin olduğundan gerekmez |
| `GAME2048_LLM_PROVIDER` | (yok) | 🧠 Kişisel koç sağlayıcısı (yoksa `/analysis` kapalı) |
| `GAME2048_LLM_KEY` | (yok) | LLM API anahtarı — **yalnız sunucuda**, istemci paketine asla girmez |
| `GAME2048_LLM_MODEL` | (sağlayıcıya göre) | Kullanılacak model |
| `GAME2048_LLM_DAILY_MAX` | (sınır) | Kullanıcı başına günlük koç isteği tavanı (maliyet kontrolü) |

Yedekleme/servis değişkenleri (`GAME2048_BACKUP_DIR`, `GAME2048_BACKUP_RETENTION`,
`GAME2048_SERVICE`, `GAME2048_HEALTH_URL`, `GAME2048_ALERT_WEBHOOK`) için
[`deploy/README.md`](deploy/README.md).

## Uç noktalar

Yetki: **(Bearer)** işaretli uçlar `Authorization: Bearer <token>` ister
(token `/register` veya `/login`'den gelir). Gövde JSON.

### Hesap
| Yöntem | Yol | Gövde | Döner |
|--------|-----|-------|-------|
| POST | `/register` | `{username, password, email, data}` | `{token, user}` |
| POST | `/login` | `{username, password}` | `{token, user}` · 401 `bad_credentials` · 429 |
| POST | `/logout` (Bearer) | — | `{ok}` |
| POST | `/account/delete` (Bearer) | `{password}` | `{ok}` · 403 `wrong_password` · 401 — **hesabı + tüm veriyi kalıcı siler**, kullanıcı adını serbest bırakır |
| GET | `/me` (Bearer) | — | `{user, data}` |

### İlerleme (bulut senkronu)
| Yöntem | Yol | Gövde | Döner |
|--------|-----|-------|-------|
| POST | `/sync` (Bearer) | `{data}` | `{data}` — **alan bazlı birleşmiş** anlık görüntü (son-yazan-kazanır DEĞİL) |

### Skor / sıralama (sunucu doğrular)
| Yöntem | Yol | Gövde | Döner |
|--------|-----|-------|-------|
| POST | `/monthly/submit` (Bearer) | `{seed, moves, size, score}` | `{score}` — sunucu replay ile **kendi** hesaplar; uydurma reddedilir (400) / hız sınırı (429) |
| POST | `/daily/submit` (Bearer) | `{seed, moves, size}` | `{score}` |
| POST | `/monthly/claim` (Bearer) | — | ay sonu 1.'nin ödülü |
| GET | `/leaderboard?scope=monthly\|alltime\|friends` | — | `{top:[…], me}` |
| GET | `/daily` | — | günün tohumu + skorları |

### Arkadaş / sohbet
| Yöntem | Yol | Gövde |
|--------|-----|-------|
| GET | `/friends` (Bearer) | arkadaş + istek listesi |
| GET | `/users/search?q=` (Bearer) | kullanıcı ara |
| POST | `/friends/request` · `/friends/respond` · `/friends/remove` (Bearer) | istek gönder / kabul-ret / sil |
| GET | `/messages?with=<id>&after=<ts>` (Bearer) | sohbet mesajları |
| GET | `/messages/overview` (Bearer) | okunmamış özeti |
| POST | `/messages` (Bearer) | `{to, body}` |
| POST | `/report` (Bearer) | kullanıcı şikayeti |

### Çok oyunculu yarış
| Yöntem | Yol | Ne |
|--------|-----|-----|
| POST | `/rooms/create` · `/rooms/join` · `/rooms/leave` · `/rooms/start` (Bearer) | oda yaşam döngüsü |
| POST | `/rooms/progress` (Bearer) | canlı skor gönder (sunucu doğrular) |
| POST | `/rooms/addbot` · `/rooms/removebot` (Bearer) | isimli/kişilikli bot ekle-çıkar |
| GET | `/rooms/state?code=` (Bearer) | oda + oyuncuların canlı durumu |

### Diğer
| Yöntem | Yol | Ne |
|--------|-----|-----|
| GET | `/health` | `{ok}` (sağlık kontrolü) |
| POST | `/analysis` (Bearer) | 🧠 Kişisel koç — oyun özetinden LLM değerlendirmesi (yalnız girişliye, günlük sınırlı) |

## Veri modeli (tablolar)

`users` (kimlik + PBKDF2 **hash**'li parola + `data` JSON ilerleme), `sessions`
(token), `friendships`, `messages`, `rooms` + `room_players`, `monthly_scores` +
`monthly_prizes`, `daily_scores`, `flagged_submissions` (şüpheli gönderim kaydı),
`reports`. Parola **asla düz metin** saklanmaz. Gizlilik/veri özeti: ana
`README.md` → "Gizlilik ve veri".

## Testler

```bash
py server/run_tests.py     # her test_*.py'yi izole (kendi geçici DB) çalıştırır
```

Kapsam: skor doğrulama (hile), bulut senkron birleşme, bot paritesi (istemci↔sunucu),
replay paritesi (150 fixture), oda doğrulama, hesap silme + çıkış, yedek→geri
yükleme, sertleştirme (hız sınırı/gövde limiti), günlük takvim, koç. Ayrıntı:
kökteki `TEST-NOTES.md`.
