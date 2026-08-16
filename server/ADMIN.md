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

## NestJS geçişi notu

Canlı backend **Python** (`server/app.py`). NestJS'e (`api-nest/`) devirde bu
katman **birebir taşınmalı**: `role` alanı + admin guard (kısa TTL) + `admin_audit`
+ `/admin/*` uçları + yetkisiz-deneme loglama. Aksi hâlde yönetim yüzeyi devirde korumasız kalır.
