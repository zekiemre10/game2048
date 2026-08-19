# 2048 — Capacitor ile Android/iOS derleme

Oyun tarayıcı + Capacitor kabuğu ile yerel uygulama. Ön koşul: Android ortamı
kurulu (bkz. `docs/mobil-kurulum.md`).

## 2048 neden şanslı (config farkı yok)

- **base href `/`** (koke tasindi) → mobil derlemede `--base-href` bayrağı
  VERİLMEZ; `ng build` çıktısı web ile birebir aynı. Web dağıtımı etkilenmez.
- **API zaten MUTLAK HTTPS.** `auth.service.ts → apiBaseFor`: host `localhost`
  (Capacitor kökeni) → `https://2048.aicirkit.com/api` döner. Yani:
  - **Cleartext-HTTP engeli YOK** (Android 9+ düz HTTP'yi keser; bizimki HTTPS).
  - API ortama göre otomatik: web same-origin, mobil/localhost mutlak HTTPS.
- **CORS:** Capacitor kökeni (`https://localhost` Android, `capacitor://localhost`
  iOS) sunucu CORS'una eklendi (`server/app.py _DEFAULT_ORIGINS`). Yoksa mobil
  uygulama sunucuya bağlanamaz.

## Kurulum (yapıldı)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android \
      @capacitor/app @capacitor/splash-screen @capacitor/status-bar
# capacitor.config.ts: appId com.aicirkit.game2048, webDir dist/game2048/browser,
#   androidScheme 'https' (WebView kokeni https://localhost -> CORS ile eslesir)
npx cap add android
```

## Derleme döngüsü

```bash
npm run build            # Angular -> dist/game2048/browser
npx cap sync android     # web varliklari + plugin/config -> android/
cd android && ./gradlew.bat assembleDebug   # APK -> app/build/outputs/apk/debug/
```

> **JAVA_HOME=21 ŞART** (bkz. mobil-kurulum). Gradle PATH'teki eski Java 8'i değil
> `JAVA_HOME`'u kullanır; yanlış JDK en sık derleme hatasıdır.

## ⚠️ TUZAK: Gradle dağıtım indirmesi zaman aşımı (FortiClient/proxy)

Ağ (FortiClient) `services.gradle.org`'a çıkışı kesiyor → wrapper Gradle
dağıtımını indiremeyip **`SocketTimeoutException: Read timed out`** ile düşüyor.
Airport de bunu yaşadı.

**Çözüm (uygulandı):** Gradle **zaten önbellekte** (`~/.gradle/wrapper/dists/`),
ama wrapper `-all` sürümünü istiyordu ve o eksik indi; **tam olan `-bin`**'di.
`android/gradle/wrapper/gradle-wrapper.properties`'te:
```
distributionUrl=...gradle-8.14.3-bin.zip   # -all DEĞİL -bin (onbellekte tam olan)
```
Böylece indirme yapılmadan önbellekli dağıtım kullanılır. Bağımlılıklar (AGP,
androidx) Airport derlemesinden önbellekli. Gerekirse `--offline` ekle. Alternatif
(Airport yolu): `-all.zip`'i `curl` ile indir (proxy'den geçer), `distributionUrl`
'yi `file:///...` yap.

## APK'yı emülatöre/cihaza kurma

BlueStacks (Pie64, adb 5555) test hedefi (telefon gerekmez):
```bash
adb connect 127.0.0.1:5555
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
# BlueStacks ana ekraninda "2048" simgesi -> tikla -> oyun acilir
```

## Mobil-özel eklenenler

- **Android GERİ tuşu** (`MobileService` + `app.ts onMobileBack`): açık panel/sohbet
  varsa kapatır → oyundaysan ana ekrana döner → ana ekranda çıkış onayı sorar.
- **Güvenli alan (safe-area):** `index.html` `viewport-fit=cover` + `_base.scss`
  body'de `env(safe-area-inset-*)` padding → çentikte içerik kesilmez. Web'de env=0.
- **Dikey kilit:** `AndroidManifest.xml` `screenOrientation="portrait"`.
- **Açılış ekranı + durum çubuğu:** `@capacitor/splash-screen` (900ms, #faf8ef) +
  `@capacitor/status-bar` (koyu ikon). Simge/splash `resources/icon.png` +
  `resources/splash.png`'den `@capacitor/assets` ile üretilir.

## 🍎 iOS

macOS ŞART (Xcode). Bu makine Windows → iOS **engelli** (donanım). Mac olunca:
`npx cap add ios` + Xcode + CocoaPods.
