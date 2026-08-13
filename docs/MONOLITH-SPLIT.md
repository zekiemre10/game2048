# Monolit bölme — panel haritası, taşıma sırası, desen

App bileşeni neredeyse tüm arayüzü tek dosyada tutuyor (başlangıçta app.html
1784, app.scss 2935, app.ts 1225 satır). Bu belge panelleri, taşıma sırasını ve
her panelin izleyeceği DESENİ kaydeder. **Büyük paket** — panel panel, testleri
yeşil tutarak taşınır (bkz. ticket).

## Panel haritası (app.html'deki koşullu bloklar)

| Panel | Kapı sinyali | Durum |
|-------|--------------|-------|
| Ayarlar | `settingsOpen()` | app.html |
| Mağaza | `storeOpen()` | app.html |
| Profil | `profileOpen()` | app.html |
| Günlük meydan okuma | `dailyOpen()` | app.html |
| Skor tablosu | `leaderboardOpen()` | app.html |
| Başarımlar | `achievementsOpen()` | app.html |
| **Görevler** | `missionsOpen()` | ✅ `components/missions-panel/` |
| Arkadaşlar | `friendsOpen()` | app.html |
| Çok oyunculu oda | `mpOpen()` | app.html |
| Sohbet | `activeChat()` | app.html |
| Hesap (giriş/kayıt) | `authOpen()` | app.html |
| Çekirdek oyun (Idle + tahta + HUD + oyun-sonu overlay) | `status()` | app.html (App'te kalır) |

## Taşıma sırası (en bağımsızdan)

1. **Görevler** ✅ (PoC — desen kuruldu) · 2. Başarımlar · 3. Günlük · 4. Skor
tablosu · 5. Mağaza · 6. Profil · 7. Hesap · 8. Sohbet · 9. Arkadaşlar ·
10. Çok oyunculu (en karmaşık, en sona). Çekirdek oyun görünümü App'te kalabilir
veya en sonda `game-view` bileşenine alınır.

## Desen (her panel için)

1. `components/<panel>/` altında **standalone + OnPush** bileşen: `.ts` + `.html`
   + `.scss`. Panel state/servisleri doğrudan enjekte eder (GameService, I18n…);
   kapatmayı `close` output'u ile bildirir.
2. app.html: koşullu blok içeriği → `<app-<panel> (close)="onClose<Panel>()" />`.
   Kapı sinyali + aç/kapat App'te kalır (görünürlüğü ana bileşen yönetir).
3. app.ts: yalnız o panele ait yardımcılar/handler'lar bileşene taşınır.
4. Stiller:
   - **Paylaşılan** panel-chrome ve ilerleme çubukları → global
     `src/styles/_panels.scss` (`.settings-backdrop/-panel/-title/-note/-heading/
     -close`, `.mission-bar/.mission-fill`, `overlay-fade`/`pulse-low`
     keyframe'leri). `.btn-primary` zaten global (`_base.scss`).
   - **Panel-özel** sınıflar → bileşenin kendi `.scss`'i (kapsüllü).
5. Her taşımadan sonra: `npm run build` + `npm test` + **görsel spot-kontrol**
   (CSS birim testlerle korunmaz → paneli açıp görünümü doğrula).

## İlerleme (öncesi → şu an)

| Dosya | Başlangıç | Görevler sonrası | Hedef |
|-------|-----------|------------------|-------|
| app.html | 1784 | 1705 | < 300 |
| app.scss | 2935 | 2848 | < 500 |
| app.ts | 1225 | 1205 | sadeleşir |

Paket tamamlanınca: app.scss'teki artık chrome kopyaları (şimdilik global ile
birlikte duruyor, zararsız) kaldırılır ve `angular.json` CSS bütçesi (şu an
şişirilmiş 36k/44k) Angular varsayılanlarına (4k/8k) yaklaştırılır.
