# 2048 — Android geliştirme ortamı kurulumu

> Ekip notu (Emre · Berk · Çınar aynı yoldan geçiyor). Takıldığın nokta + çözümü
> buraya ekle; notlar birbirinizin işini yarıya indirir.

## Özet: ortam HAZIR (env bağlandı)

Bu makinede ağır kısım (Android Studio + SDK + JDK) zaten kuruluydu (Airport
mobil çalışmasından). Bu pakette yapılan iş **kabuk ortamını bağlamaktı** (env +
PATH). Doğrulanan durum:

| Bileşen | Durum |
|---|---|
| **JDK 21** (`~/.jdks/jbr-21.0.11`) | ✅ `java 21.0.11` + `javac 21.0.11` (tam JDK) — `JAVA_HOME` bu |
| Android Studio | ✅ `C:\Program Files\Android\Android Studio` |
| Android SDK | ✅ `%LOCALAPPDATA%\Android\Sdk` — Platform **android-36**, build-tools **35/36** |
| `adb` (platform-tools) | ✅ `1.0.41`, PATH'te |
| Emülatör + AVD | ✅ `Pixel_6` AVD var; **WHPX** hızlandırma kullanılabilir (hızlı çalışır) |
| SDK lisansı | ✅ `android-sdk-license` kabul edilmiş |

## Neden JDK 21 (JDK 25 ya da 8 değil)

Makinede **üç** Java var: sistem **Java 1.8** (Oracle, çok eski), Android
Studio'nun paketlediği **JDK 25** (çok yeni — Capacitor/Gradle ile sorun
çıkarabilir) ve **JDK 21** (`~/.jdks`). Capacitor'ın güncel Android hattı **JDK
21** ile uyumlu → `JAVA_HOME` buna ayarlandı. **Yanlış JDK en sık derleme
hatasıdır**; Gradle `JAVA_HOME`'u kullanır (PATH'teki `java`'yı değil).

## Ayarlanan ortam değişkenleri (kullanıcı kapsamı, kalıcı)

```
JAVA_HOME        = C:\Users\murathalicioglu\.jdks\jbr-21.0.11
ANDROID_HOME     = C:\Users\murathalicioglu\AppData\Local\Android\Sdk   (zaten vardı)
ANDROID_SDK_ROOT = C:\Users\murathalicioglu\AppData\Local\Android\Sdk
PATH += %JAVA_HOME%\bin ; %ANDROID_HOME%\platform-tools ; %ANDROID_HOME%\emulator
```

> **Yeni bir terminal aç** — env değişkenleri açık terminallere yansımaz;
> registry'ye yazıldı, yeni terminalde geçerli.

## Bilinen tuzaklar (ekip için)

1. **`java -version` hâlâ 1.8 gösteriyor.** Sistem PATH'inde eski Oracle Java 8
   var (`C:\ProgramData\Oracle\Java\javapath`) ve **sistem PATH, kullanıcı
   PATH'inden önce** okunur → varsayılan `java` 1.8 kalır. **Önemli değil:**
   Gradle/Capacitor `JAVA_HOME`'u (=21) kullanır. Temizlemek istersen: *Programlar
   ve Özellikler → Java 8'i kaldır*, ya da (admin) o dizini sistem PATH'inden çıkar.
2. **`sdkmanager` CLI yok** (`cmdline-tools` kurulu değil). SDK lisansları/paketleri
   için Android Studio → **SDK Manager** (GUI) kullan. CLI şart olursa: SDK
   Manager → SDK Tools → "Android SDK Command-line Tools (latest)" kur.
3. **Emülatör yavaşsa:** WHPX (Windows Hypervisor Platform) açık olmalı — burada
   açık. Kapalıysa: *Windows Özellikleri → Windows Hypervisor Platform* + BIOS'ta
   sanallaştırma (VT-x).

## Emülatör / cihaz — DOĞRULANDI (BlueStacks ile)

Telefon yok → test hedefi olarak **BlueStacks** kullanıldı (Airport'ta da öyleydi).
BlueStacks hem emülatör hem `adb devices`'daki cihaz yerine geçer:

```powershell
adb connect 127.0.0.1:5555      # BlueStacks Pie64 (adb portu conf'ta 5555)
adb devices                     # 127.0.0.1:5555   device
# dogrulandi: model SM-G998B · Android 9 · x86_64 · sys.boot_completed=1 (hazir+hizli)
```

> **Tuzak (Berk/Çınar):** Android Studio'nun **Pixel_6** AVD'si **16KB-sayfa
> (`android-37.1 ps16k`)** sistem imajı kullanıyor → OS boot'u aşırı yavaş (6+ dk
> hâlâ boot animasyonunda). `adb devices`'da görünür ama tam açılması uzun sürer.
> **Çözüm:** BlueStacks'e `adb connect 127.0.0.1:5555` (hızlı), ya da SDK Manager'dan
> **standart** bir x86_64 sistem imajı indirip daha hafif bir AVD oluştur.
> BlueStacks + Android Studio emülatörü **aynı anda** açma — aynı hipervizörü
> paylaşıp çakışırlar; birini kapat.

## Kalan adım (tek — sonraki pakete ait)

- **`npx cap doctor`:** Capacitor projeye **eklenince** (sonraki paket) tam temiz
  çıkar; şu an game2048'de Capacitor yok, bu yüzden bu adım o pakete kalıyor.
- (İstersen gerçek telefon da bağlanabilir: *Geliştirici seçenekleri + USB hata
  ayıklama* → `adb devices`. Zorunlu değil; BlueStacks yeterli.)

## 🍎 iOS — ENGELLİ (donanım)

Bu makine Windows (`oyna.bat` var). **Xcode yalnız macOS'ta** çalışır → iOS build
bu makinede **yapılamaz**. Bu bir kod sorunu değil, donanım gereksinimi. Mac
erişimi olunca: Xcode + Command Line Tools + CocoaPods gerekir.

## Hızlı doğrulama (yeni terminalde)

```powershell
$env:JAVA_HOME              # ...\.jdks\jbr-21.0.11
& "$env:JAVA_HOME\bin\java.exe" -version   # 21.0.11
adb --version              # 1.0.41
adb devices                # cihaz bagliysa listede
emulator -list-avds        # Pixel_6
```
