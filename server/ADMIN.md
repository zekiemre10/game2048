# 2048 — Yönetim (admin) yetkilendirmesi

Yönetim panelinin **ilk ve zorunlu parçası**: yetki katmanı. Panel işlevleri
(kullanıcı listesi, skor moderasyonu, sohbet şikayetleri, ekonomi) sonraki
paketlerde gelir; hepsi buradaki role + denetim temeli üstüne kurulur.

> **Ön koşul (sağlandı):** Site HTTPS üzerinden yayında (`https://2048.aicirkit.com/`).
> Yönetici parolası/oturumu **asla düz HTTP'de** gitmemeli.

## Karar: panel AYRI bir uygulamadır

Yönetim arayüzü **oyun paketine dahil edilmez** — ayrı bir uygulama olur ve bu
backend'in `/admin/*` API'sini tüketir.

**Gerekçe:** Yönetim kodu/rotaları oyun paketine girerse **her oyuncu onu indirir**;
bu hem saldırı yüzeyini büyütür hem de yönetim mantığını/uç adlarını sızdırır.
Oyun frontend'i yalnızca oyuncu içindir. Yetki tamamen **sunucuda** (`role` +
`_admin_row`); istemciye güvenilmez.

## Yetki modeli

- `users.role`: `'user'` (varsayılan) veya `'admin'`.
- `/admin/*` uçları **admin + TAZE oturum** ister. Admin oturumu normalden
  **kısa** ömürlüdür (`ADMIN_SESSION_TTL`, öntanımlı **12 saat**; normal oturum
  90 gün) → çalınan jetonun hasar penceresi dar. Süresi geçen admin, yönetim
  için **yeniden giriş** yapmalı (oyun oturumu etkilenmez).
- Yetki yoksa/eskimişse: **403** + denetim kaydına `unauthorized_admin_access`
  (kim denedi — biliniyorsa —, hangi uç, IP).

## İlk yöneticiyi tanımlama

Kullanıcı **önce normal kayıt olmalı**, sonra iki yoldan biri:

**A) Ortam değişkeni (önerilen — tekrarlanabilir, belgeli).**
Servise `GAME2048_ADMIN_BOOTSTRAP=<kullanıcı adı>` ver; açılışta o kullanıcı
admin yapılır (idempotent). systemd örneği:
```ini
# /etc/systemd/system/game2048-api.service → [Service]
Environment=GAME2048_ADMIN_BOOTSTRAP=emre
```
```bash
sudo systemctl daemon-reload && sudo systemctl restart game2048-api
journalctl -u game2048-api --since '1 min ago' | grep '\[admin\] bootstrap'
```

**B) Elle SQL (tek seferlik).**
```bash
sudo -u game2048 sqlite3 /var/lib/game2048-api/app.db \
  "UPDATE users SET role='admin' WHERE username_lower = lower('emre');"
```

## Uç noktalar

Hepsi: **admin + taze oturum** ister · denetlenir · `X-Robots-Tag: noindex`
(+ global `nosniff` / `DENY` / `CSP`). Yetkisiz → **403**.

| Yöntem | Yol | Ne |
|--------|-----|-----|
| GET | `/admin/whoami` | `{username, role, admin:true}` — panel açılışı/doğrulama |
| GET | `/admin/audit?limit=` | son denetim kayıtları (en yeni önce, ≤500) |
| POST | `/admin/users/role` `{username, role}` | rol ata (`user`\|`admin`); **admin→user** düşürünce hedefin tüm oturumları kapanır; **denetlenir** |

## Denetim kaydı (`admin_audit`)

Her yönetim işlemi + her yetkisiz deneme yazılır: `admin_id, admin_username,
action, target_type, target_id, detail, ip, created`. Okuma: `GET /admin/audit`.

## Güvenlik özeti

- HTTPS zorunlu (sağlandı) · admin oturumu kısa (12h) · yetkisiz denemeler IP'yle
  loglanır · `/admin/*` arama motorlarına kapalı · tek noktada yetki kontrolü
  (`_admin_row`) → **korumasız yönetim ucu yok** (bkz. `test_admin.py`).

## Sonraki paketler için sözleşme

Yeni bir `/admin/*` ucu eklerken **ilk satır** `_admin_row(conn)` olmalı (None
dönerse `return`), ve durum değiştiren her işlem `audit_log(...)` çağırmalı.

## Sohbet moderasyonu ve şikayet

Katmanlı koruma (arkadaşlar arası özel sohbet için):

1. **Engelleme (kullanıcı düzeyi — en hızlı koruma, yönetici beklemez):**
   `POST /block` · `POST /unblock` · `GET /blocks`. Engellenen kişi artık
   engelleyene **mesaj ve arkadaş isteği gönderemez** (`_message_send` /
   `_friend_request` içinde `is_blocked` kontrolü). Engelleme mevcut arkadaşlığı da kaldırır.
2. **Şikayet:** `POST /report {targetId|targetUsername, reason, detail?, msgId?, context?}`
   → `reports` tablosuna `status='new'` düşer. `msgId` verilirse panelde SINIRLI
   bağlam o mesajın etrafında gösterilir.
3. **Otomatik filtre:** yasaklı kelime listesi (`contains_banned`) mesaj + kullanıcı
   adında zaten uygulanır (Faz-2 sertleştirme).
4. **Yönetici müdahalesi:** `GET /admin/reports?status=` (kuyruk), `POST
   /admin/reports/resolve {id,status}` (new/reviewing/resolved), `POST
   /admin/users/moderate {username, action, minutes?, reason}` —
   action: `warn | mute | unmute | suspend | unsuspend`.
   - **mute:** süreli (1 dk–30 gün); susturulan **mesaj gönderemez**.
   - **suspend:** hesap **giriş yapamaz**, açık oturumları kapatılır.
   - Hepsi **denetim kaydına** (`admin_audit`) yazılır.

### 🔐 Gizlilik (kodda uygulanır — sadece belgede değil)

Bunlar **özel** mesajlar. Yönetici **serbest sohbet TARAYAMAZ**: rastgele iki
kullanıcının konuşmasını çeken bir uç **yoktur**. Tek erişim
`GET /admin/reports/context?id=<reportId>` ve o da **yalnızca** şikayet edilen
mesajın (`msg_id`) **en çok ±3** komşusunu, **yalnızca** şikayet eden ile edilen
arasında döndürür (`_admin_report_context`, `CTX=3`). `msg_id` yoksa sohbet
içeriği hiç dönmez. Bu bağlam erişimi de denetim kaydına yazılır.

### Bildirim ve itiraz

Her moderasyon eylemi etkilenen kullanıcıya **sebebiyle** bildirilir
(`mod_notices` → `GET /moderation/notices`; susturma bitişi + askı durumu dahil).
**İtiraz:** kullanıcı bildirimdeki sebebi görüp itirazını hesap e-postasından
iletir; yönetici `admin_audit` + şikayet bağlamıyla yeniden değerlendirir
(gerekirse `unmute`/`unsuspend`).

### Kullanıcılara duyurulacak politika

"Özel mesajların gizlidir; **yalnızca hakkında şikayet gelirse**, şikayet edilen
mesaj ve dar bir çevresi yöneticiye görünür. Yönetici sohbetlerini serbestçe
okuyamaz." (Bkz. ana `README.md` → Gizlilik ve veri; arayüzde şikayet/engelle
akışında da gösterilmeli.)

### Oyuncu arayüzü (uygulanmış)

Oyun frontend'i bu backend'i şu noktalarda tüketir (yalnızca oyuncu tarafı;
yönetici kuyruğu **ayrı panele** aittir — bkz. "panel AYRI bir uygulamadır"):

- **Sohbet paneli** (`components/chat-panel`): başlıkta 🚩 *kullanıcıyı şikayet*
  + 🚫 *engelle*; her gelen mesajda 🚩 *mesajı şikayet*. Şikayet penceresi = sebep
  seçimi + isteğe bağlı açıklama + **gizlilik notu** (yalnız şikayet edilen mesaj
  görünür). `POST /report {targetId, reason, detail?, msgId?}` · `POST /block`.
- **Arkadaş listesi** (`components/friends-panel`): her arkadaş satırında 🚫 engelle.
- **Gönderim engeli geri bildirimi**: susturulmuş/engellenmiş/askılı kullanıcı mesaj
  yollayınca sebep sohbette gösterilir (`chat.service` → `sendError`).
- **Moderasyon bildirimi** (`components/mod-notice` + `services/moderation.service`):
  giriş varken `GET /moderation/notices` yoklanır; uyarı/susturma/askı **sebebiyle**
  ve (varsa) bitiş zamanıyla banner'da gösterilir + itiraz yolu hatırlatılır.
  Kullanıcı kapatınca (localStorage) tekrar çıkmaz. i18n anahtarları `mod.*`
  (TR+EN). Testler: `moderation.service.spec.ts`.

## Skor tablosu moderasyonu (hileli kayıtları temizle)

Faz-2 sunucu doğrulaması (`replay_game` + `flagged_submissions`) gelecekteki
hileyi zorlaştırır ama iki şey için elle araç şart: **geçmiş** şüpheli kayıtlar ve
hiçbir doğrulamanın %100 olmaması. Bu katman skor tablosunun güvenilirliğini korur.

> **Neden kritik:** tablo üç sekmeli (Bu Ay · Tüm Zamanlar · Arkadaşlar) ve aylık
> şampiyona **2000 altın + güçler** veriliyor. Tek hileli kayıt tüm ayın yarışını
> değersizleştirir.

### Tespit (`score_audit.py` — saf, test edilir)

Kayıt başına açıklanabilir işaretler:
- **`score_below_tile_min`** (imkânsız): 2^k karesine ulaşmak için asgari skor
  (k−1)·2^k'nın altında skor. (2048 → asgari 20480.)
- **`moves_below_tile_min`** (imkânsız, yalnız `daily` — hamle saklanır): 2^k için
  asgari 2^(k−1)−1 hamlenin altında.
- **`high_score_per_move`** (şüpheli): skor/hamle oranı aşırı.
- **`field_outlier`** (şüpheli): skor, alandaki 2.'yi katbekat aşıyor.
- **`sudden_jump`** (şüpheli): oyuncunun önceki en iyisinin katbekat üstünde.
- **Bilinen sınır:** oyun **süresi** hiçbir tabloda saklanmıyor → "imkânsız kısa
  süre" doğrudan ölçülemez; oran + asgari-hamle bunun vekilidir.

`impossible` = matematiksel olarak olanaksız (güçlü kanıt); `suspect` = elle
inceleme gerekir. **Otomatik SİLME yok** — işaret yalnızca yöneticiyi yönlendirir.

### Geçersiz kılma (silme değil — işaretleme, geri alınabilir)

`score_invalidations (scope, period, user_id UNIQUE, score, reason, admin, reverted…)`.
Aktif (reverted=0) kayıt, ilgili skor tablosundan **düşürülür**; hiçbir skor verisi
silinmez → **geri alınabilir** (`reverted=1` tarihçeyi korur). **Gerekçe zorunlu**
(boşsa `400 reason_required`). Tablodan düşme koddan uygulanır:
- `monthly` → `_leaderboard` aylık sorgusu aktif geçersizleri filtreler.
- `alltime`/`friends` (skor `users.data`'da) → `leaderboard_rows(exclude_ids=…)`.
- Sıra hesapları da geçersizleri saymaz.

### Aylık şampiyonluk düzeltmesi

`month_champion_row` her zaman **geçerli** 1.'yi seçer; `resettle_month` ödülü
yeniden atar:
- Ödül **talep edilmemişse** → doğrudan sıradaki geçerli oyuncuya geçer.
- **Talep edilmişse** (`claimed=1`) → `monthly_prizes.revoked=1`, ödül doğru
  kazanana (talep edilmemiş) yazılır, `prize_revoked_claimed` denetime düşer,
  eski kazanan bilgilendirilir. **Geri alma politikası:** verilmiş 2000 altının
  otomatik geri alınması YAPILMAZ (bakiye negatife düşebilir / yıkıcı) →
  **elle** yönetici kararı. Bu bilinçli bir tasarım seçimidir.

### Uç noktalar (hepsi admin + taze oturum + denetlenir)

| Yöntem | Yol | Ne |
|--------|-----|-----|
| GET | `/admin/scores?scope=&period=&flagged=&sort=&limit=` | kayıtlar + işaretler (scope: monthly\|alltime\|daily; sort: score\|severity) |
| GET | `/admin/scores/report` | **ilk temizlik raporu**: son 6 ay + tüm-zamanlar + bugün; yalnız işaretliler, scope'a gruplu + özet |
| POST | `/admin/scores/invalidate` `{userId, scope, period?, reason}` | geçersiz kıl (gerekçe zorunlu); aylık şampiyonsa resettle; kullanıcıya bildirim |
| POST | `/admin/scores/revert` `{userId, scope, period?}` | geçersiz kılmayı geri al; aylık ise resettle |

### Bildirim ve itiraz

Her işlem etkilenen kullanıcıya `mod_notices` ile **sebebiyle** bildirilir
(`score_invalidated` / `score_restored`) → `GET /moderation/notices` (oyuncu
banner'ı gösterir). İtiraz: kullanıcı sebebi görüp hesap e-postasından iletir;
yönetici `admin_audit` + kayıtla yeniden değerlendirir (`revert`).

Testler: `test_score_audit.py` (saf matematik) + `test_score_moderation.py`
(düşürme/geri alma/şampiyonluk/bildirim/denetim/yetki).

## Metrik panosu (📈 veriye dayalı karar)

Veri zaten birikiyordu ama okunmuyordu. Bu katman **sorgu + hafif enstrümantasyon**
ekler; kalıcı pano ekranı **ayrı yönetici uygulamasına** aittir (bu API'yi tüketir).

**Var olan tablolardan** (yeni veri gerektirmez): kullanıcı sayısı + kayıt eğrisi
(`users.created`), seviye hunisi + skor dağılımı (`data` blob'u `bestLevel`/
`bestScore`), çevrimiçi kullanım (`friendships`/`messages`/`room_players`).

**Üç HAFİF, ANONİM tablo** (eksikler için — `merge_progress` whitelist'i mod tutmaz,
`sessions` silinebilir):
- `user_activity(user_id, day)` — DAU/WAU + tutunma. `_auth_row`'da **günde tek**
  yazılır (bellek koruması). user_id İÇ kimlik; **hiçbir metrik çıktısında dönmez**.
- `events(ts, name, mode, level, score)` — mod dağılımı. **KİŞİSEL VERİ YOK**
  (user_id/IP tutulmaz). İstemci `ModesService` 5 başlangıç noktasından
  `POST /events {name:'game_start', mode}` gönderir (ateşle-unut, anonim).
- `daily_metrics(day, requests, errors)` — sunucu sağlığı; `_dispatch` bellek
  sayacı → 30sn'de bir flush (daemon).

Sorgu indeksleri eklendi (`users.created`, `user_activity.day`, `events.*` …) →
**<1sn**. `metrics.py` (saf, test edilir) `compute(from,to)` tüm grupları döner;
tutunma **kohort bazlı** (D+1 / D+1..D+7); UTC gün aritmetiği (`calendar.timegm`).

| Yöntem | Yol | Ne |
|--------|-----|-----|
| GET | `/admin/metrics?from=&to=` | pano metrikleri (öntanımlı son 30 gün) — admin + denetlenir |
| POST | `/events` `{name, mode?, level?, score?}` | **anonim** olay (auth'suz, IP-sınırlı) |

Ayrıca CLI: `python3 metrics_report.py app.db` (salt-okunur JSON dökümü).

### 🔒 Gizlilik (kabul kriteri)

Toplanan **hiçbir metrik kişisel veri içermez**: çıktı yalnız toplam sayı / oran /
kova. Ad, e-posta, IP, ham kullanıcı kimliği DÖNMEZ. `events` anonimdir. `user_activity`
yalnız iç kimlik+gün tutar ve dışa açılmaz (yalnız DAU/WAU/tutunma toplamlarına girer).
Veri yokken tüm gruplar sıfır/boş döner (arayüz bozulmaz). Testler: `test_metrics.py`.

## NestJS geçişi notu

Canlı backend **Python** (`server/app.py`). NestJS'e (`api-nest/`) devirde bu
katman **birebir taşınmalı**: `role` alanı + admin guard (kısa TTL) + `admin_audit`
+ `/admin/*` uçları + yetkisiz-deneme loglama + **skor moderasyonu**
(`score_invalidations` + tablo filtreleme + `resettle_month`). Aksi hâlde yönetim
yüzeyi devirde korumasız kalır.
