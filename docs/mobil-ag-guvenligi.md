# 2048 — Mobil ağ güvenliği (Android cleartext & iOS ATS)

## 🎯 Ana tespit: 2048 bu sorundan MUAF (API zaten HTTPS)

Ticket'ın varsayımı: API `http://34.158.136.9/emre/2048/api` (düz HTTP). **Bu 2048
için ARTIK GEÇERLİ DEĞİL.** 2048 alan adı köküne taşındı; mobil uygulamanın kullandığı
API adresi:

```
https://2048.aicirkit.com/api      (auth.service.ts → apiBaseFor → DEV_API_BASE)
```

HTTPS + gerçek alan adı + geçerli Let's Encrypt sertifikası. Sonuçlar:

| Konu | Durum |
|---|---|
| **Android cleartext engeli** | **Etkilemez** — API HTTPS, düz-HTTP değil. Uygulama sorunsuz bağlanır. |
| **iOS ATS** | **Sağlanır** — ATS zaten TLS + geçerli sertifikalı alan adı ister; 2048 bunu karşılar. İstisna gerekmez. |
| **Mağaza riski (parola/JWT açık)** | **YOK** — e-posta/parola/JWT **TLS üzerinden** gider. Ticket'ın premisinin tersine, düz-HTTP değil. |

> Yani bu paket 2048 için pratikte bir **doğrulama + belgeleme** işidir; Kelimebaz /
> Bilgi Küpü hâlâ HTTP IP'deyse onlarda gerçek cleartext işi gerekir.

## ✅ Yine de: debug'a özel, IP-kapsamlı fallback eklendi

Bir geliştirici canlı HTTPS yerine **düz-HTTP bir dev backend'e** (ham sunucu IP'si
ya da yerel makinedeki Python backend) bağlanmak isterse diye, **YALNIZCA debug**
derlemesinde dar bir cleartext istisnası tanımlandı. **Battaniye izin YOK.**

- `android/app/src/debug/res/xml/network_security_config.xml` — izinli adresler:
  `34.158.136.9` (sunucu IP), `10.0.2.2` (emülatör→host), `localhost`. Başka her şey korumalı.
- `android/app/src/debug/AndroidManifest.xml` — `android:networkSecurityConfig`'i
  **yalnızca debug**'a bağlar (manifest merger release'e katmaz).
- ❌ **`android:usesCleartextTraffic="true"` KULLANILMADI** (battaniye izin → mağaza reddi).

### Derleme-türü ayrımı DOĞRULANDI

`processDebugMainManifest` + `processReleaseMainManifest` ile birleştirilmiş
manifestler kontrol edildi:

- **debug** merged manifest → `android:networkSecurityConfig="@xml/network_security_config"` **VAR** ✓
- **release** merged manifest → networkSecurityConfig **YOK** ✓ → varsayılan (Android 9+ cleartext engeli) geçerli.

## 🔌 CORS & köken (androidScheme)

- `capacitor.config.ts` → `androidScheme: 'https'` → WebView kökeni **`https://localhost`**.
- Sunucu CORS'una Capacitor kökenleri (`https://localhost`, `capacitor://localhost`)
  eklendi + **canlıya deploy** edildi. Doğrulandı:
  ```
  OPTIONS https://2048.aicirkit.com/api/login   Origin: https://localhost
  → 204 · Access-Control-Allow-Origin: https://localhost · Methods GET,POST,OPTIONS · Headers Content-Type,Authorization
  ```
  Yani giriş/kayıt (POST + Authorization) ve skor gönderimi mobil kökeninden CORS-onaylı.
- `server.cleartext` ile karıştırılmadı (o ayar canlı yeniden yükleme içindir; kullanılmadı).

## 📱 Cihazda doğrulama

Uygulama BlueStacks'te açıldı ve API'ye **HTTPS** üzerinden ulaşıyor (cleartext engeli
yok + CORS onaylı). Giriş/kayıt ve skor gönderimini uygulama içinden deneyerek canlı
görebilirsin — altyapı (HTTPS + CORS) doğrulandı.

## 🍎 iOS ATS — araştırma sonucu

- ATS istisnası (`NSExceptionDomains`) **alan adı** bekler; IP için dar istisna
  sorunludur ve seni battaniye `NSAllowsArbitraryLoads`'a iter (App Review gerekçe sorar).
- **2048'de bu engel YOK:** API bir **alan adı** (`2048.aicirkit.com`) + **HTTPS** +
  geçerli sertifika. ATS varsayılan olarak karşılanır → **hiçbir istisna gerekmez.**
- Xcode yalnız macOS'ta çalışır; bu makinede Mac yok → iOS **derlenmedi**. Ama ATS
  açısından 2048 zaten temiz (alan adı + HTTPS), ek yapılandırma gerektirmez.

## ⚠️ Mağaza riski — 2048 için DÜŞÜK

Ticket ciddi bir risk (parola/JWT düz-HTTP) uyarıyor; **2048'de bu risk yok** çünkü
tüm trafik `https://2048.aicirkit.com` üzerinden TLS ile şifreli. Debug'daki cleartext
fallback **release'de yok** (doğrulandı). Yani release mağazaya çıkarken korumasız
trafik taşımaz.

## 🧹 Temizlik / takip

- 2048 zaten HTTPS olduğu için release'de kaldırılacak bir cleartext istisnası **yok**
  (istisna yalnızca debug'da, dev kolaylığı). OYUN-224 (HTTPS) 2048 için pratikte
  **zaten sağlanmış** (kök alan adı HTTPS).
- Debug fallback'i tümüyle kaldırmak istersen: `android/app/src/debug/` altındaki iki
  dosyayı sil — hiçbir şey bozulmaz (uygulama HTTPS kullanıyor).
