# 2048 backend — dağıtım altyapısı

Backend (`server/app.py`) **gerçek kullanıcı verisi** tutar (hesaplar, skorlar,
arkadaşlıklar, sohbet — `app.db`). Bu klasör onu güvenilir çalıştırmak ve verisini
kaybetmemek için gereken her şeyi içerir: systemd servisi, nginx yapılandırması,
otomatik yedekleme + geri yükleme, bakım, sağlık kontrolü.

Python stdlib dışında bağımlılık yoktur; servis `127.0.0.1:8092` dinler, nginx
`/emre/2048/api` yolunu ona proxy'ler.

## Yol konvansiyonu (uyarlanabilir)

| Ne | Yol |
|----|-----|
| Sunucu kodu | `/opt/game2048-api/` (`app.py`, `bot_ai.py`, `replay.py`, fixtures, `deploy/`) |
| Veritabanı | `/var/lib/game2048-api/app.db` (KOD dizini DIŞINDA → redeploy silmez) |
| Yedekler | `/var/backups/game2048-api/` |
| Frontend statikleri | `/var/www/emre/2048/` |
| Servis kullanıcısı | `game2048` (ayrıcalıksız) |

Birim dosyalarındaki yolları kendi düzenine göre düzenle.

## İlk kurulum (sunucuda, bir kez)

```bash
# 1) Ayrıcalıksız kullanıcı + dizinler
sudo useradd --system --home /var/lib/game2048-api --shell /usr/sbin/nologin game2048
sudo mkdir -p /opt/game2048-api /var/lib/game2048-api /var/backups/game2048-api
sudo apt-get install -y sqlite3            # backup/maintenance için

# 2) Kodu yerleştir (server/ içeriğini kopyala)
sudo cp -r server/* /opt/game2048-api/
sudo chmod +x /opt/game2048-api/deploy/*.sh

# 3) Var olan DB'yi taşı (varsa) veya boş başlat
#    (app.py ilk açılışta tabloları kurar)
sudo mv /eski/yol/app.db /var/lib/game2048-api/app.db 2>/dev/null || true
sudo chown -R game2048:game2048 /var/lib/game2048-api /var/backups/game2048-api /opt/game2048-api

# 4) systemd servisi: otomatik başlatma + çökünce yeniden başlatma
sudo cp /opt/game2048-api/deploy/game2048-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now game2048-api
systemctl status game2048-api            # active (running) olmalı
curl -fsS http://127.0.0.1:8092/health   # {"ok": true}

# 5) Zamanlanmış işler: yedek (günlük) + bakım (haftalık) + sağlık (~5dk)
sudo cp /opt/game2048-api/deploy/game2048-backup.*      /etc/systemd/system/
sudo cp /opt/game2048-api/deploy/game2048-maintenance.* /etc/systemd/system/
sudo cp /opt/game2048-api/deploy/game2048-healthcheck.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now game2048-backup.timer game2048-maintenance.timer game2048-healthcheck.timer
systemctl list-timers | grep game2048

# 6) Günlük boyut sınırı (journald genel; kalıcı + sınırlı tut)
sudo sed -i 's/^#\?Storage=.*/Storage=persistent/; s/^#\?SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
```

### nginx (paylaşımlı dosya)

> ⚠️ Bu makinede üç oyun sitesi TEK dosyada: `/etc/nginx/sites-available/cinar`.
> Yanlış düzenleme üç siteyi birden düşürür. **Güvenli desen** (Kelimebaz
> `nginx_add_rooms.py` ile aynı):

```bash
sudo cp /etc/nginx/sites-available/cinar /etc/nginx/sites-available/cinar.$(date +%F-%H%M%S).bak
sudoedit /etc/nginx/sites-available/cinar   # deploy/nginx-2048.conf bloklarını 2048 server{} içine ekle
sudo nginx -t && sudo systemctl reload nginx || {
  echo "nginx -t başarısız → yedekten geri yükle:"; echo "  sudo cp cinar.*.bak cinar && sudo nginx -t && sudo systemctl reload nginx"; }
```

Bloklar: [`nginx-2048.conf`](nginx-2048.conf) — `/emre/2048/api` proxy'si (`X-Forwarded-For`
gerçek IP için, `X-Forwarded-Proto`, `client_max_body_size 512k`) + SPA statikleri.

## İşletim

**Günlükler:**
```bash
journalctl -u game2048-api -f            # canlı
journalctl -u game2048-api --since today
journalctl -u game2048-backup -u game2048-healthcheck --since '1 day ago'
```

**Yedekler:** `game2048-backup.timer` her gün `03:30`'da `backup.sh`'i çalıştırır —
SQLite `.backup` ile **sıcak** (online) tutarlı kopya alır (`cp` DEĞİL; açık DB'de
kopya bozuk olabilir), gzip'ler, bütünlüğünü doğrular, 14 günden eskiyi siler.
Elle: `sudo -u game2048 GAME2048_DB=/var/lib/game2048-api/app.db /opt/game2048-api/deploy/backup.sh`

**Geri yükleme (bir yedekten dönme):**
```bash
ls -lh /var/backups/game2048-api/                          # uygun yedeği seç
sudo /opt/game2048-api/deploy/restore.sh /var/backups/game2048-api/app-YYYYMMDD-HHMMSS.db.gz
```
`restore.sh`: servisi durdurur → mevcut DB'yi `.pre-restore-*` olarak saklar →
yedeğin bütünlüğünü doğrular → yerine koyar → servisi başlatır → `/health` yoklar.

> **Geri dönme DENENDİ:** `server/test_backup_restore.py` bu döngüyü otomatik
> kanıtlar (kullanıcı kaydet → sıcak yedek → veriyi sil → geri yükle → veri sağlam).
> Sunucuda da bir kez elle koştur (yeni bir yedek al, `restore.sh` ile geri dön,
> `/health` ve bir girişi doğrula).

**Bakım:** `game2048-maintenance.timer` haftalık (Paz 04:00) `integrity_check` +
`wal_checkpoint` + `VACUUM` yapar (dosyayı sıkıştırır; düşük trafik saatinde).

**Sağlık:** `game2048-healthcheck.timer` ~5dk'da bir `/health` yoklar; başarısızsa
journald'a yazar, (ayarlıysa `GAME2048_ALERT_WEBHOOK`) webhook'a bildirir ve
**asılı** (çökmemiş ama yanıtsız) süreci yeniden başlatır. systemd zaten ÇÖKEN
süreci `Restart=on-failure` ile kaldırır.

## Kod güncelleme (redeploy)

```bash
sudo cp -r server/* /opt/game2048-api/          # DB /var/lib'de, ETKİLENMEZ
sudo chown -R game2048:game2048 /opt/game2048-api
sudo chmod +x /opt/game2048-api/deploy/*.sh
sudo systemctl restart game2048-api
curl -fsS http://127.0.0.1:8092/health
```

## Doğrulama listesi (kabul kriterleri)

- [ ] `sudo systemctl enable --now game2048-api` → yeniden başlatmada otomatik kalkar
      (`sudo reboot` sonrası `systemctl is-active game2048-api` = active).
- [ ] Süreç çökünce yeniden başlar (`Restart=on-failure`; test: `sudo systemctl kill -s SIGKILL game2048-api` → birkaç sn sonra tekrar active).
- [ ] `game2048-backup.timer` etkin; `/var/backups/game2048-api/` dolar.
- [ ] Geri yükleme denendi (`test_backup_restore.py` + sunucuda bir kez elle).
- [ ] nginx blokları `cinar` dosyasında; `nginx -t` temiz.
- [ ] Bu belge dağıtım adımlarını içerir.
