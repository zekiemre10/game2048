# Monolit bölme — panel haritası, taşıma sırası, desen

App bileşeni neredeyse tüm arayüzü tek dosyada tutuyordu (başlangıçta app.html
1784, app.scss 2935, app.ts 1225 satır). Bu belge panelleri, izlenen DESENİ ve
öncesi/sonrası boyutları kaydeder. **Büyük paket** — panel panel, testleri yeşil
tutarak taşındı.

## Panel haritası — hepsi ayrı bileşene taşındı ✅

| Bileşen | Kapı sinyali (App'te) |
|---------|-----------------------|
| `components/settings-panel` | `settingsOpen()` |
| `components/store-panel` | `storeOpen()` |
| `components/profile-panel` | `profileOpen()` |
| `components/daily-panel` | `dailyOpen()` |
| `components/leaderboard-panel` | `leaderboardOpen()` |
| `components/achievements-panel` | `achievementsOpen()` |
| `components/missions-panel` | `missionsOpen()` |
| `components/friends-panel` | `friendsOpen()` |
| `components/multiplayer-panel` | `mpOpen()` |
| `components/chat-panel` | `activeChat()` |
| `components/auth-panel` | `authOpen()` |
| `components/game-view` | `status() !== Idle` (çekirdek oyun: HUD + yan panel + tahta + oyun-sonu overlay) |

App'te kalan: **üst çubuk** (profil hapı + aksiyon butonları), panel gate
sinyalleri + aç/kapat orkestrasyonu, klavye/dokunmatik girişi (window
dinleyicileri → `tryMove`), skor gönderimi/kutlama effect'leri, ilk-oyun rehberi
ve konfeti. `app-start-screen` zaten ayrı bileşendi.

## Desen (her panel/görünüm için)

1. `components/<ad>/` altında **standalone + OnPush** bileşen: `.ts` + `.html` +
   `.scss`. Gereken servisleri doğrudan enjekte eder (GameService, I18n…).
2. Kapatma `close` output'u ile bildirilir; ana bileşeni etkileyen eylemler
   (hesap panelini aç, ana ekrana dön, konfeti patlat) ayrı output'larla
   (`openAuth`, `goHome`, `openMultiplayer`, `celebrate`) bildirilir.
3. app.html: koşullu blok → `<app-<ad> (close)="onClose<Ad>()" … />`. Görünürlüğü
   ana bileşen yönetir.
4. app.ts: yalnız o panele ait state/handler bileşene taşınır; ana bileşende
   sadece gate + üst çubuk + effect'lerin ihtiyacı kalır.
5. Stiller:
   - **Paylaşılan** chrome/çubuk/liste/düğme → global `src/styles/_panels.scss`:
     `.settings-backdrop/-panel/-title/-note/-heading/-close/-section`,
     `.mission-bar/.mission-fill(+.h-*)`, `.lb-list/.lb-row/.lb-rank/.lb-name/
     .lb-tile/.lb-score`, `.friend-muted/.friend-error/.friend-btn`,
     `.account-cta`, `.store-tabs`, `.lang-choice`, `.auth-error`, +
     `overlay-fade`/`pulse-low` keyframe'leri. `.btn-primary(+:disabled/.ghost)`
     zaten global (`_base.scss`).
   - **Panel-özel** sınıflar → bileşenin kendi (kapsüllü) `.scss`'i.
6. Her taşımadan sonra: `npm run build` + `npm test` + **görsel spot-kontrol**
   (CSS birim testlerle korunmaz → paneli açıp görünümü doğrula).

## Öncesi → sonrası

| Dosya | Başlangıç | Şimdi | Hedef | Durum |
|-------|-----------|-------|-------|-------|
| app.html | 1784 | **160** | < 300 | ✅ |
| app.scss | 2935 | **184** | < 500 | ✅ |
| app.ts | 1225 | **540** | sadeleşti | ✅ |
| CSS bütçesi (angular.json) | 36k/44k | **13k/16k** | 4k/8k (varsayılan) | kısmi |

Yeni: `src/styles/_panels.scss` (288, global) + 12 bileşen (`game-view` +
11 modal panel), her biri standalone + OnPush.

### Kalan (varsayılan CSS bütçesine ulaşmak için)

`game-view.scss` ~12kB ile en büyük bileşen stili; Angular varsayılanı 8kB'a
inmek için `game-view` daha küçük parçalara bölünebilir (ör. `game-hud`,
`game-side-panel`, `game-over-overlay`). Bu ayrı bir alt-paket; mevcut yapı
çalışır ve bütçe zaten 44k→16k düşürüldü.
