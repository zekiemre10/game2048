# 2048 — Sayı Birleştirme Bulmacası

[![game2048 CI](https://github.com/aicirkit1/emre/actions/workflows/game2048-ci.yml/badge.svg)](https://github.com/aicirkit1/emre/actions/workflows/game2048-ci.yml)

Klasik **2048** oyununun Angular ile sıfırdan yeniden yazımı. Standalone bileşen
mimarisi, signal tabanlı durum yönetimi, saf ve test edilebilir oyun mantığı.

## 🎮 Canlı Oyna

### **http://34.158.136.9/emre/2048/**

Bilgisayarda **ok tuşlarıyla**, telefonda **parmakla kaydırarak** oynanır.

## Ekran Görüntüleri

| Açık tema                               | Koyu tema                              |
| --------------------------------------- | -------------------------------------- |
| ![Açık tema](docs/screenshot-light.png) | ![Koyu tema](docs/screenshot-dark.png) |

| Başlık ekranı                               | Mobil                                              |
| ------------------------------------------- | -------------------------------------------------- |
| ![Başlık ekranı](docs/screenshot-start.png) | <img src="docs/screenshot-mobile.png" width="260"> |

| Profil (ünvan + avatar)                | Başarımlar (ilerleme çubuklu)                   |
| -------------------------------------- | ----------------------------------------------- |
| ![Profil](docs/screenshot-profile.png) | ![Başarımlar](docs/screenshot-achievements.png) |

### Çevrimiçi özellikler

| Arkadaşlar                                 | Sohbet                              | Çok oyunculu yarış                               |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------ |
| ![Arkadaşlar](docs/screenshot-friends.png) | ![Sohbet](docs/screenshot-chat.png) | ![Çok oyunculu](docs/screenshot-multiplayer.png) |

## Nasıl oynanır

- Ok tuşlarıyla (↑ ↓ ← →) veya parmakla kaydırarak kareleri it.
- Aynı sayıya sahip iki kare çarpışınca **birleşir** ve değerleri toplanır (2+2=4).
- Bir hamlede her kare **en fazla bir kez** birleşir (zincirleme yok: `2 2 4` → `4 4`).
- Her geçerli hamleden sonra boş bir hücreye yeni kare gelir (%90 "2", %10 "4").
- Amaç **2048** karesine ulaşmak. Ulaşınca "Devam Et" ile oynamaya devam edebilirsin.
- Izgara dolup hiç birleşme kalmayınca oyun biter.

**Seviye Modu:** Her seviyede belirli bir hedef kareye (128 → 256 → 512 → 1024 → 2048)
verilen süre içinde ulaşman gerekir. İlerledikçe süre kısalır (3:00 → 1:30), oyun
zorlaşır. Süre dolar veya hamle biterse seviye başarısız olur ("Tekrar Dene").
Hedefe ulaşınca sonraki seviyeye geçersin. Ulaştığın en yüksek seviye kaydedilir.

## 🤖 Yapay zekâ

Oyunun içinde, **API anahtarı ve internet gerektirmeyen** bir yapay zekâ çalışır:
`logic/ai.ts` içindeki **expectimax** arama motoru (yılan-gradyan sezgiseli, şans
düğümü örneklemesi, **yinelemeli derinleşme + zaman sınırı**). Tüm YZ özellikleri
bu tek motordan gelir:

- 💡 **Hamle önerisi** — oyun başına 5 hak; en iyi yönü ok olarak gösterir
- 🤖 **YZ gösterimi** — "YZ Oynasın" ile motoru izle. **Yalnızca örnektir:** durdurunca
  tahtan, skorun, sürün ve hakların aynen geri gelir; ilerlemen etkilenmez
- 🎭 **Karakter rakipler** — çok oyunculu odaya **isimli, kişilikli** bot rakipler
  ekle: **📐 Köşeci** (köşe disiplini, güçlü), **⚖️ Dengeli** (her yönü dengeler),
  **🌿 Alan Açan** (boş alanı kollar, uzun yaşar), **⚡ Acelesi Var** (hızlı skor,
  sonra tıkanır). Hepsi **aynı motoru farklı ağırlık setiyle** besler (yeni
  algoritma yok); güçleri `scripts/bot-characters-bench.mjs` ile **ölçülür** ve
  seçim ekranında gösterilir. Bot **SUNUCUDA** koşar (adil, kararlı, manipüle
  edilemez), insanla **aynı tohumlu** diziyi oynar; yarışta kişilikli **laf atar**
  (TR/EN). Karakter bazlı galibiyetin profilde tutulur. (İç zorluk kademeleri
  Kolay/Orta/Zor/Uzman ipucu + YZ gösterimi için korunur.)
- 🎯 **Bana uygun rakip** — elle seçimin yanında **uyarlanabilir** bir seçenek:
  son N oyunundaki (tahta **boyutu bazında**) ortalama skoruna göre sana **kıl
  payı** yarışacak bir rung eşlenir. Zorluk **kademeli** değişir (kayan pencere +
  tek basamak sınırı → tek oyundan sonra sıçramaz); üst üste kayıplarda gözle
  görülür kolaylaşır. Eşleme ölçülen güç merdivenine oturur
  (`scripts/adaptive-ladder-bench.mjs`), yeni oyuncuya makul bir başlangıç verir.
- ✨ **Hamle kalitesi** — her hamlen YZ'nin seçimiyle kıyaslanır: _Mükemmel · İyi ·
  Daha iyisi vardı (↑)_ — oyun sonunda **doğruluk yüzdesi** özeti
- 🟢 **Canlı pozisyon göstergesi** — tahtanın sağlığı (İyi / Riskli / Tehlikeli);
  boş alan, köşe kullanımı ve kalan hamle yönlerinden hesaplanır
- 🔍 **Oyun sonu değerlendirmesi** — köşe stratejisi, verimlilik ve kişisel ipucu
- 📉 **Hamle zaman çizelgesi** — oyun sonunda "nerede kaybettin?" grafiği: yatayda
  hamleler, dikeyde pozisyon sağlığı; hatalı hamleler işaretli, sağlığın en sert
  düştüğü **dönüm noktası** vurgulu ("38. hamlede tahtan bozuldu"). Bir noktaya
  tıklayınca o andaki tahta + YZ'nin önerdiği hamle görünür. Asistan kapalıyken de
  sağlık eğrisi + dönüm noktası çalışır (yalnız hamle-kalitesi işaretleri sönük)
- 🧠 **Kişisel koç (LLM)** — oyun bitince "🧠 Kişisel koç" ile, senin oyununa özel,
  insan diliyle 2-4 cümlelik değerlendirme: oyunun özeti (mod, skor, doğruluk,
  dönüm noktası, sağlık eğrisi) sunucudaki `/analysis` uç noktasına gönderilir,
  model somut ve öğretici bir paragraf döndürür. **API anahtarı yalnızca sunucuda**
  (ortam değişkeni), istemci paketinde asla bulunmaz. Yalnızca giriş yapmış
  oyunculara; maliyet kontrolü (kullanıcı başına günlük + kısa pencere sınırı,
  oyun-başına tek çağrı). Sunucu erişilemez / anahtar yoksa **sessizce algoritmik
  analize düşer** — özellik hiçbir zaman hata göstermez. Metin, YZ tarafından
  üretildiği açıkça belirtilerek gösterilir

Ayarlar'daki **🧠 YZ Asistanı** anahtarı öneri, hamle kalitesi ve pozisyon
göstergesini birlikte açar/kapatır. Hamle başına ek maliyet ortanca **~2 ms**
(en kötü ~40 ms) — arayüz hiç takılmaz. Yukarıdakilerin **tümü istemcide,
çevrimdışı ve ücretsiz** çalışır; TEK istisna, isteğe bağlı **kişisel koç**
(LLM): oyun sonunda butonla tetiklenir, tek çalışma-zamanı LLM çağrısıdır ve
API anahtarı yalnızca sunucuda tutulur.

### Zorluk merdiveni (ölçülmüş)

Bot rakibin **dört zorluğu** artan güçtedir ve gelişen oyuncuya **kademeli**
bir merdiven sunar. Motor `scripts/ai-bench.mjs` ile ölçülür (4×4, tam oyun):

| Seviye    | Arama                                     | Ort. skor  | 2048'e ulaşma | ms/hamle | Önceki kademeye oran |
| --------- | ----------------------------------------- | ---------- | ------------- | -------- | -------------------- |
| Kolay     | derinlik 1 (sığ)                          | 5.041      | %0            | 0.02     | —                    |
| Orta      | derinlik 2, kaba örnekleme + düz sezgisel | 15.192     | %23           | 0.03     | **3.0×**             |
| Zor       | derinlik 2, tam sezgisel                  | 35.038     | %67           | 0.08     | **2.3×**             |
| **Uzman** | **derinlik 3→4 (yinelemeli)**             | **55.343** | **%100**      | **17.7** | **1.6×**             |

Her kademe bir öncekinden ölçülebilir şekilde güçlü ve **ardışık fark 5 katı
geçmiyor** (kademeli geçiş). Uzman hamle başına **17.7 ms ≤ 30 ms**.
_(Kolay/Orta/Zor 30 oyun; Uzman yavaş olduğundan 10 oyun.)_

**Eski hata (bu iş):** Kolay ile Orta arasında **25 kat uçurum** vardı — Kolay
2048'e hiç ulaşmıyor, Orta oyunların %97'sinde ulaşıyordu; arada seçenek yoktu.
İki sebep vardı: (1) Kolay **%30 tamamen rastgele** hamle yapıyordu — tek kötü
hamle köşe düzenini bozup tahtayı kilitliyor, ipuçlarıyla çelişiyordu; (2) tek
lever derinlikti ve derinlik 1→2 arası skoru 3.5k'dan 33k'ya sıçratıyordu.

**Çözüm:** rastgele hamle **tamamen kaldırıldı** — artık her seviye **hep
mantıklı** oynar. Zayıflatma üç **deterministik** knob üzerinden yapılır:

- **derinlik** — kaç hamle ileri baktığı (baskın lever),
- **sampleK** — şans düğümü örnekleme genişliği (1 = kaba beklenen değer),
- **snakePow / emptyMul** — sezgisel güç (köşe/monotonluk gradyanı + boş hücre
  ödülü; düşük değerler yapıyı zayıflatır ama makul hamleyi bozmaz).

Kolay–Orta boşluğu, derinlik 2'de kaba örnekleme + düzleştirilmiş sezgiselle
dolduruldu (Orta = "iki hamle ileri ama isabetsiz"). Değerler
`scripts/ai-calibrate.mjs` taramasıyla banda oturtuldu; `ai-strength.spec.ts`
seviye eşiklerini, sıralamayı ve ≤5× geçişi regresyon olarak korur.

**Bot zorluğu VERİ olarak taşınır** (görünen addan çözülmez — o kırılgandı: ad
çevrilince/emoji eklenince seviye sessizce Orta'ya düşerdi). Sunucu `/rooms/addbot`
seviyeyi doğrular ve `room_players.level` sütununda saklar, oda durumunda `level`
alanı olarak döndürür. Görünen bot adı seviyeden ve aktif dilden üretilir (dil
değişince ad da güncellenir). Eski odalardaki (alan boş) botlar güvenle **Orta**'ya düşer.

### Sunucu botu — çok oyunculu yarışta bot SUNUCUDA koşar

Bot eskiden **host'un tarayıcısında** koşuyor ve skorunu host'un istemcisi
bildiriyordu. Üç sorun vardı: **kararsızlık** (host sekmeyi kapatınca/arka plana
alınca bot durur/yavaşlar), **adaletsizlik** (hız host'un cihazına bağlıydı) ve
**güvenilmezlik** (host, botun — rakibinin — skorunu istediği gibi değiştirebilirdi).

**Tasarım kararı: oda başında tek seferlik skor ÇİZELGESİ (gerçek zamanlı sunucu
botu değil).** Oyun tohumlu ve mantık saf olduğundan botun oyunu deterministiktir;
yarış başlayınca sunucu botun oyununu **bir kez** oynatıp kümülatif skor zaman
çizelgesini üretir, yarış boyunca geçen süreye göre yayınlar. Gerekçe: gerçek
zamanlı hesap **sürekli CPU** tüketir ve çok odada ölçeklenmez; çizelge yaklaşımının
CPU maliyeti **tek seferliktir** ve aynı adaleti/manipülasyon direncini sağlar.

Nasıl:

- **Motor Python'a taşındı** (`server/bot_ai.py`), istemcideki `ai.ts` bot
  fonksiyonlarının birebir eşi. Determinizm için **sabit derinlik** (zaman sınırı
  yok) ve **tam-sayı ağırlıklar** kullanılır → tek transandantal işlem (`pow`)
  sabitlenir, geri kalan her şey IEEE/tam-sayı aritmetiğidir. Parite
  `server/test_bot_parity.py` (TS'in ürettiği `bot_fixtures.json`) ile korunur:
  **aynı tohum → Python ve TS birebir aynı oyun** (24/24 fixture).
- **Skor yalnızca sunucuda** üretilir; `/rooms/botprogress` **kaldırıldı** — istemciden
  bot skoru artık kabul edilmez.
- Skor çizelgesi **artımlı** yayınlanır: hesap yarış saatini ~9× geçer (Uzman d3'te
  ~26ms/hamle hesap vs 240ms/hamle tempo), böylece ~20s'lik hesap arka planda
  birikirken bot hiç aç kalmaz.
- **CPU koruması:** oda başına en çok **5 bot**; yalnızca yarış süresini kaplayacak
  kadar hamle hesaplanır. Ölçülen önhesap (180s yarış): Kolay 65ms · Orta 0.5s ·
  Zor 1.8s · **Uzman ~20s** (arka planda, bir kez; Uzman derinliği bu yüzden 3).
- **Host sekmesi kapansa da** bot devam eder (çizelge sunucuda); host insan ayrılırsa
  kuruculuk başka insana devredilir, bot etkilenmez.
- İstemci artık bot çalıştırmaz (eski `BotRunner` kaldırıldı); "YZ Oynasın" gösterimi
  ayrı ve tek-oyuncudur.

## Özellikler

- 🎯 **Doğru 2048 mantığı** — saf, framework'süz, tam test edilmiş
- ⌨️ **Klavye + dokunmatik** — ok tuşları ve swipe
- ⏱️ **Süre ve hamle sayacı** — üstte gösterim, sonuç ekranında toplam
- 🎯 **Seviye modu** — her seviyede hedef kare + geri sayım; ilerledikçe süre kısalır, hedef büyür; ulaşılan seviye kaydedilir
- 💰 **Altın + Mağaza** — seviye tamamlayınca altın kazan; mağazadan güç/tema al
- ⚡ **Güçler** — ⏰ +30sn · 💣 bomba (kare sil) · 🔀 karıştır · ↩️ geri al · 💡 ipucu
- 🎨 **Temalar** — Neon, Okyanus, Orman, Gün Batımı (altınla açılır)
- 👤 **Profil** — avatar seçimi, **ünvan** (Çırak → Kalfa → Usta → Üstat → Efsane),
  9 istatistik, gün serisi
- 🏅 **Başarımlar** — ana ekranda özet şerit, panelde **ilerleme çubuklu** liste
  ("512 Kulübü — 128/512")
- ⏸️ **Duraklat** — yalnızca tahtayı örter, sayaç durur
- 🎁 **7 günlük ödül takvimi** — üst üste her gün gel, ödül büyüsün:
  30 → 50 altın → 💣 bomba → 90 altın → ↩️ 2 geri al → 140 altın →
  **7. gün: 250 altın + 3 ipucu**. Seri kırılmazsa tur baştan başlar
- 🎯 **Görevler** — günlük ve haftalık görevler; oynadıkça ilerler, altın verir
- 🌍 **Dil (TR/EN)** — Ayarlar'dan geçiş; arayüzün tamamı iki dilde
- 🎮 **Modlar** — Klasik · Zen (süresiz) · Zaman Yarışı (3dk) · Seviye · Günlük + tahta boyutu (3×3/4×4/5×5)
- 👤 **Hesap** — kayıt/giriş (kullanıcı adı + e-posta), ilerleme buluta kaydı, cihazlar arası senkron
- 👥 **Arkadaşlar** — kullanıcı ara, istek gönder/kabul et, arkadaş listesi (skor/seviye özeti)
- 💬 **Sohbet** — arkadaşlar arası mesajlaşma, emoji seçici, okunmamış rozeti (yakın-gerçek zamanlı)
- 🏁 **Çok oyunculu yarış** — oda kur, 4 haneli kodla davet, ortak tohumla adil yarış + canlı skor tablosu
- 📅 **Günlük meydan okuma** — herkes o gün **aynı tahtayı** oynar (tohum tarihten
  türetilir; istemci ve sunucu aynı formülü kullanır). 3 dakika, güçler kapalı,
  en iyi skorun günlük sıralamaya girer
- 🏆 **Skor tablosu** — üç sekme: **Bu Ay** · Tüm Zamanlar · Arkadaşlar.
  İlk üçte madalya, kendi sıran listede olmasan da gösterilir
- 👑 **Aylık şampiyonluk** — sıralama **her ay yeniden başlar**; ay sonunda
  1. olan **2000 altın + her güçten 3 adet** kazanır ve profilinde 🏆 rozeti
     birikir. Oyuncunun kendi rekoru ve ilerlemesi **asla sıfırlanmaz** —
     aylık yarış ayrı bir tablodur
- 🎉 **Kutlama efektleri** — başarım / seviye / 2048 anında konfeti + ses
- 🎓 **İlk oyun rehberi** — yeni oyuncuya 6 adımlık tanıtım (Ayarlar'dan tekrar açılır)
- 🏠 **Ana ekran** — başlığa / mod seçimine dönüş (oyun ekranında ← tuşu)
- 🖥️ **İki sütunlu düzen** — geniş ekranda solda büyük tahta, sağda bilgi paneli
  (süre, güçler, YZ, kontroller); dar ekranda tek sütuna iner
- ↶ **Geri al** — son hamleyi geri al (kaybettiren hamle dahil)
- 🏆 **Kalıcı rekor** — en yüksek skor `localStorage`'da saklanır
- ⚙️ **Ayarlar paneli** — müzik, ses seviyeleri, tema (tercihler kalıcı)
- 🎵 **Arka plan müziği** — "Calm Mind – Chill Lofi Beat" (Pixabay)
- 🔊 **Ses efektleri** — Web Audio ile prosedürel (hamle / birleşme)
- 🌙 **Açık/koyu tema** — tercih kalıcı, sistem tercihini varsayılan alır
- ✨ **Akıcı animasyonlar** — kayma, pop-in, birleşme "bump"ı
- 📱 **Responsive** — telefon, tablet, masaüstü
- ♿ **Erişilebilirlik** — `prefers-reduced-motion`, odak halkaları, 44px dokunma hedefleri

## Teknolojiler

- [Angular 22](https://angular.dev/) — standalone bileşenler, **signals**
- TypeScript
- SCSS (CSS değişkenleriyle temalama)
- Web Audio API (prosedürel ses efektleri)
- Expectimax oyun ağacı araması (yapay zekâ — bağımlılıksız, saf TypeScript)
- Vitest (259 birim/bileşen testi)
- **Backend:** Python standart kütüphanesi — `http.server` + `sqlite3` + `pbkdf2` (hesap,
  arkadaşlar, sohbet, çok oyunculu yarış). Ek bağımlılık yok; nginx arkasında ayrı serviste çalışır.

## Proje yapısı

```
src/
  app/
    components/
      board/           # 4×4 ızgara zemini + kare katmanı
      tile/            # Tek kare: renk, konum, animasyonlar
      start-screen/    # Başlık ekranı
    services/
      game.service.ts        # İNCE FAÇADE — sabit dış API'yi alt servislere delege eder (bkz. "Servis mimarisi")
      board-store.ts         # Kernel: ham tahta durumu (tiles/skor/hamle/durum/mod) + primitifler + RNG
      game-engine.ts         # Hamle akışı + oyun-sonu kuralları + skor/rekor + başarım/görev/ödül orkestrasyonu
      modes.service.ts       # 5 mod kurulumu (Klasik/Zen/Zaman/Seviye/Günlük) + yaşam döngüsü + geri al
      timer.service.ts       # Süre: yukarı sayan + geri sayım + duraklat (geri sayım bitince motora geri çağrı)
      autoplay.service.ts    # "YZ'yi izle" motoru: gösterim + durdurunca oyuncu durumunu geri yükle
      assistant-store.ts     # YZ asistanı durumu: hamle kalitesi + sağlık + öneri + autoplay bayrakları
      power-effects.service.ts # Güç ETKİLERİ (bomba/karıştır/ipucu/+30sn); envanter ayrı serviste
      powers.service.ts      # Güç envanteri + satın alma + oturum bayrakları
      economy.service.ts     # Altın bakiyesi + toplam kazanç
      profile.service.ts     # Kimlik (ad/avatar/şampiyonluk) + rekorlar + ömürlük istatistikler
      achievements.service.ts# Başarım kümesi + koşul/ilerleme (yaprak: stat parametreyle gelir)
      missions.service.ts    # Günlük + haftalık görevler + ilerleme + ödül
      rewards.service.ts     # Gün serisi (streak) + 7 günlük ödül takvimi
      cloud-sync.service.ts  # Hesap anlık görüntüsü + sunucudan geri uygulama
      game-storage.ts        # TÜM localStorage okuma/yazma (saf fonksiyonlar, tek yer)
      theme.service.ts       # Açık/koyu tema (localStorage)
      audio.service.ts       # Arka plan müziği (loop, ses, kalıcı)
      sfx.service.ts         # Ses efektleri (Web Audio, prosedürel)
      i18n.service.ts        # Dil (TR/EN) — statik metin + model verisi çevirisi
      auth.service.ts        # Hesap: kayıt/giriş, token, ilerleme senkronu
      friends.service.ts     # Arkadaşlar: ara/istek/kabul/liste (yoklamalı)
      chat.service.ts        # Sohbet: mesaj gönder/al, okunmamış rozeti
      multiplayer.service.ts # Çok oyunculu: oda/kod/başlat + canlı ilerleme
      ai.service.ts          # Oyun sonu değerlendirmesi (algoritmik, anahtarsız)
      leaderboard.service.ts # Skor tablosu (genel / arkadaşlar)
      daily.service.ts       # Günlük meydan okuma: sonuç gönderimi + sıralama
    logic/
      board-logic.ts   # SAF hamle mantığı (kaydırma + birleştirme)
      ai.ts            # SAF yapay zekâ: expectimax + hamle kalitesi + pozisyon sağlığı
      bot-runner.ts    # SAF bot koşucusu (çok oyunculu YZ rakibi, tohumlu)
      rank.ts          # SAF ünvan hesabı (puan → rütbe + ilerleme)
      daily-challenge.ts # SAF günlük tohum (sunucudaki formülle birebir aynı)
      missions.ts      # SAF görev üretimi + ISO gün/hafta anahtarları
      swipe.ts         # SAF dokunmatik yön tespiti
      format-time.ts   # SAF süre biçimlendirme (mm:ss)
    models/
      tile.model.ts    # Tile, Grid, Direction, GameStatus, GameMode
  styles/
    _variables.scss    # Kare paleti, ölçüler, animasyon süreleri
    _base.scss         # Tema değişkenleri (:root + [data-theme=dark])
server/
  app.py               # Backend: hesap + arkadaşlar + sohbet + çok oyunculu (Python stdlib)
```

## Servis mimarisi (oyun katmanı)

Oyun mantığı eskiden tek bir 2.000+ satırlık `game.service.ts` içindeydi (13
farklı test dosyası = 13 farklı sorumluluğun itirafı). Artık her biri **tek
sorumluluğu olan** ve **500 satırın altında** servislere bölündü. `GameService`
ince bir **façade**'dır: eski (sabit) dış API'yi korur ve alt servislere delege
eder — böylece paneller/uygulama/testler değişmeden çalışır.

**Katmanlar (bağımlılık TEK YÖN — aşağıya doğru; döngü yok):**

```
                         GameService  (façade — sabit dış API)
                              │  delege
   ┌──────────────┬──────────┼───────────────┬──────────────┐
   ▼              ▼          ▼                ▼              ▼
ModesService  PowerEffects  AutoplayService  CloudSync   (doğrudan delegeler)
   │  (mod)      │ (etki)      │ (YZ izle)      │ (senkron)
   └──────┬──────┴──────┬──────┘                │
          ▼             ▼                        │
      GameEngine  (hamle akışı + oyun-sonu + orkestrasyon)
          │                                      │
   ┌──────┴───────────────────────────────┬─────┘
   ▼                                       ▼
BoardStore (tahta kernel'i)    Domain servisleri: economy · profile ·
TimerService · AssistantStore   achievements · missions · rewards · powers
   │                                       │
   └───────────────► game-storage.ts ◄─────┘   (tüm localStorage, tek yer)
```

**İlkeler:**

- **Kernel = BoardStore.** Oyunun "kaynak gerçeği" (taşlar, skor, hamle, durum,
  mod, seviye, geçmiş) + tahta primitifleri (kare üret, tohumlu RNG, transkript).
  Hiçbir bağımlılığı yok; herkes bunu okur/yazar.
- **Yaprak domain servisleri** kendi durumunu + kalıcılığını tutar; başkasına
  bağımlılıkları ya yoktur ya da yalnızca daha alttakine (ör. `powers → economy`).
  Başarımlar gibi "koşulu okuyan" servislere gereken veri **parametre olarak**
  geçer — böylece çekirdeğe geri bağlanmazlar (döngü engellenir).
- **GameEngine** hamleyi işler ve skor/başarım/görev/ödül/kutlamayı **orkestre
  eder**; durumu alt servislerde tutar, yalnızca çağırır.
- **Mod kurulumu, güç efektleri ve otomatik oynatma** GameEngine'i (ve durumu)
  _aşağı_ enjekte eder; GameEngine bunları geri enjekte etmez → **döngüsel
  bağımlılık yoktur.** Süre bitişi gibi ters yönlü tek olay, TimerService'e
  atanan bir **geri çağrı** (callback) ile motora bildirilir.
- **Kalıcılık + bulut senkronu tek yerde:** tüm `localStorage` erişimi
  `game-storage.ts`'te (saf fonksiyonlar), hesap anlık görüntüsü/geri uygulama
  `cloud-sync.service.ts`'te toplanır.

Mevcut 13 `game.service.*.spec.ts` dosyası `GameService` façade'ı üzerinden
(davranış aynı kaldığından) değişmeden geçer; her biri zaten bir alan (seviye,
güçler, görevler, ödüller, profil, review…) test ettiğinden yeni servislerin
sözleşmesini de doğrular.

## Backend (çevrimiçi özellikler)

Hesap, arkadaşlar, sohbet ve çok oyunculu yarış için `server/app.py` küçük bir
Python servisidir (yalnızca standart kütüphane — `http.server`, `sqlite3`,
`hashlib.pbkdf2`). Şifreler tuzlanıp özetlenir; oturumlar Bearer token ile taşınır.
JSON uçları: `/register` · `/login` · `/me` · `/sync` · `/friends*` · `/messages*` ·
`/rooms*` · `/analysis` (LLM koç — API anahtarı yalnızca sunucuda, ortam
değişkeninden; anahtar yoksa 503 → istemci şablon analizine düşer). Çok oyunculu
yarışta tüm oyunculara **ortak tohum** gönderilir; böylece
herkes birebir aynı taş dizisini alır (adil yarış), skorlar ~1sn'de bir eşitlenir.

Güvenlik önlemleri: PBKDF2-SHA256 (600k tur, kullanıcıya özel tuz), sabit zamanlı
karşılaştırma, oturum jetonu **süre sınırı**, girişte hız sınırı, istek gövdesi üst
sınırı, oda durumunda **üyelik kontrolü** (tohum sızıntısını önler), skor
gönderiminde hız sınırı ve tüm hataların JSON yanıta çevrilmesi.

### 🔒 Skor doğrulama (hile önleme)

Skor tablosu ve aylık şampiyonluk **istemciye güvenmez**. İstemci skoru
göndermez; yalnızca oyunun **tohumu + hamle dizisini** ("U/D/L/R") gönderir.
Sunucu (`server/replay.py`) oyunu `mulberry32` ile birebir yeniden oynatıp
skoru **kendisi hesaplar** ("kural tek yerde"). Böylece konsoldan uydurma bir
skor göndermek imkânsızdır — bozuk/sahte transkript reddedilir ve
`flagged_submissions` tablosuna kaydedilir.

- **Determinizm garantisi:** İstemci (`src/app/logic/replay.ts`) ve sunucu
  (`server/replay.py`) mantığı **birebir aynı** sonucu verir; parite testleriyle
  (150 fixture + gerçek oyun transkriptleri) doğrulanır.
- **Çok oyunculu oda skorları da doğrulanır:** `/rooms/progress` artık istemcinin
  skorunu kabul etmez; canlı yarışta gönderilen **hamle transkripti** odanın
  tohumuyla her bildirimde yeniden oynatılıp skoru sunucu hesaplar. Böylece bir
  oyuncu konsoldan skorunu şişirip arkadaşlarını yenemez; sahte transkript
  reddedilip `flagged_submissions`'a yazılır, skor `MAX()` ile yazıldığından
  sıra dışı/eski bildirim skoru geriletemez. (2048 replay'i tam-sayı ve hızlı
  olduğundan tam replay ucuzdur; artımlı doğrulamaya gerek yoktur.)
- **Bot skoru istemciden hiç alınmaz:** bot artık **sunucuda** koşar (yukarıdaki
  "Sunucu botu" bölümü); `/rooms/botprogress` kaldırıldı. Karar gerekçesi:
  transkript doğrulaması botu da kapsayabilirdi, ama asıl temiz çözüm — botun
  rakibin (host'un) istemcisinden hiç geçmemesi — sunucuda koşturmaktır.
- **Güç kullanılan oyunlar sıralamaya girmez** — bomba/karıştır/geri al hamle
  dizisinden türetilemez; ayrıca herkes eşit şartlarda yarışır.
- **Günlük meydan okuma:** tohum sunucuda günden hesaplanır (istemci kolay bir
  tohum seçemez).
- Ek katmanlar: gönderim **hız sınırı**, akla yatkınlık kaydı, ay sonu ödülü
  yalnızca doğrulanmış skorla verilir.

### 🛡️ Backend sertleştirme

Herkese açık API kötüye kullanıma karşı sertleştirildi:

- **CORS daraltıldı:** eskiden `Access-Control-Allow-Origin: *` idi (her site
  API'yi tarayıcıdan kullanabiliyordu). Artık yalnızca **izinli köken(ler)**
  yansıtılır (`GAME2048_CORS_ORIGINS` ortam değişkeni; varsayılan canlı köken +
  yerel geliştirme). İzinsiz köken ACAO **almaz**.
- **Güvenlik başlıkları:** her yanıtta `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` ve sıkı
  `Content-Security-Policy: default-src 'none'` (API yalnızca JSON döner).
- **Uç nokta hız sınırları (429):** girişin yanında artık **kayıt** (IP başına
  8/10dk), **mesaj** (30/dk), **arkadaş isteği** (20/dk), **oda kurma** (10/dk),
  **kullanıcı arama** (30/dk) ve **şikayet** (10/saat) sınırlıdır. Auth'lu uçlar
  kullanıcı-kimliğiyle sınırlanır (ters-proxy IP'sinden bağımsız, doğru). Ayrıca
  gerçek istemci IP'si biliniyorsa (nginx `X-Forwarded-For`) kaba bir **genel IP
  sınırı** uygulanır (asıl IP sınırı nginx `limit_req` ile de yapılabilir).
- **İçerik filtresi (TR + EN):** yasaklı kelime listesi kullanıcı adı (kayıtta)
  ve sohbet mesajlarında uygulanır; leet/ayraç kaçışları normalize edilerek
  yakalanır, `klasik→sik` gibi yanlış-pozitifler tam-kelime eşleşmeyle önlenir.
- **Şikayet (report):** kullanıcıdan kullanıcıya `/report` uç noktası;
  kayıtlar **reports** tablosuna yazılır (yönetim paneli inceler).
- **Kullanıcı arama:** asgari 2 karakter, en çok 15 sonuç, LIKE joker kaçırma
  (numaralandırma önlenir) + hız sınırı.
- **Hata sızıntısı yok:** tüm işleyici hataları merkezî olarak JSON'a çevrilir;
  traceback yalnızca sunucu günlüğüne gider, istemci genel bir hata kodu alır.

Normal oyun akışı bu sınırlardan etkilenmez (test edildi).

### ☁️ Bulut senkronu — alan bazlı birleştirme (son-yazan-kazanır DEĞİL)

İlerleme cihazlar arasında senkronlanır. Eskiden `/sync` gelen bloğu **körü
körüne yazıyordu** → iki cihazda paralel oynanan ilerleme **sessizce siliniyordu**
(telefon çevrimdışıyken PC'de açılan başarım, telefon bağlanınca eziliyordu; ya da
giriş yapınca bulut yereli ezip o cihazda çevrimdışı kazanılanı siliyordu).

Artık gelen veri saklananla **alan alan birleşir** (`server/app.py` →
`merge_progress`); hiçbir taraf sessizce kaybolmaz. Kurallar alan tipine göre:

| Alan                                   | Kural                                                                                                                    | Neden                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Rekorlar (skor, kare, seviye)          | **MAX** — büyük olan kazanır                                                                                             | rekor düşmemeli                                                                     |
| İstatistikler (oyun/hamle/şampiyonluk) | **MAX** (monoton sayaç)                                                                                                  | asla geriye gitmez                                                                  |
| Başarımlar                             | **BİRLEŞİM**                                                                                                             | açılan hiçbir başarım kapanmaz                                                      |
| **Altın bakiyesi**                     | **özel:** kazanılan(monoton) ve harcanan(=kazanılan−bakiye, o da monoton) **ayrı ayrı MAX**; bakiye = kazanılan−harcanan | bir cihazda kazanılan + diğerinde harcanan **ikisi de** korunur → kayıp/çoğalma yok |
| Tercihler (ad, avatar)                 | **EN SON** değişen kazanır (`prefsAt` damgası)                                                                           | çakışan tercihte deterministik                                                      |

Her snapshot **sürüm (`v`) + zaman damgası** taşır; sunucu birleştirmeyi bunlarla
yapar ve **birleşmiş (güvenilir) sonucu geri döndürür** → istemci yerelini onunla
günceller, böylece diğer cihazın ilerlemesi de bu cihaza gelir. Giriş/açılış artık
`/me`-ezme yerine `/sync`-birleştirme yolundan geçer. Eski (sürümsüz) bloklara
toleranslıdır → **mevcut hesaplar göçte bozulmaz** (testle doğrulandı).

> **Altın neden özel, güçler neden şimdilik yerel?** Harcanabilir bir _bakiye_'yi
> güvenle birleştirmek için tek değer yetmez; kazanılan/harcanan gibi **monoton**
> geçmiş gerekir (aksi hâlde MAX ile harcanan altın "dirilir", SUM ile çoğalır).
> Altında `totalGoldEarned` zaten tutulduğundan harcanan = kazanılan−bakiye ile
> türetilir ve **kesin** birleşir. **Güçler** ise şu an cihaz-yerelidir
> (senkronlanmaz) → senkron-kaybı yaşamaz; buluta eklendiğinde aynı desenle
> (güç başına `alınan`/`kullanılan` monoton sayaç, MAX-birleştirme) yapılmalıdır.
> Geçmiş tutulmadan geriye dönük eklemek ilk birleştirmede miktarı bozabileceği
> için bu paketde güçler bilinçli olarak yerel bırakıldı.

```bash
# Sunucu tarafı replay parite testi (istemci = sunucu skoru)
python3 server/test_replay_parity.py
# Uçtan uca: uydurma skor reddi + meşru oyun kabulü
python3 server/test_submit_integration.py
# Bulut senkronu birleştirme: iki cihaz + rekor/başarım/altın + göç
python3 server/test_sync_merge.py
# Backend sertleştirme: CORS + hız sınırları + içerik filtresi + report + hata
python3 server/test_hardening.py
# Yedekten geri dönme: sıcak yedek → veri kaybı → geri yükle → veri sağlam
python3 server/test_backup_restore.py
# Oda skoru doğrulaması: uydurma reddi + meşru kabul + canlı sıralama
python3 server/test_rooms_progress_verify.py
# Sunucu botu: bot sunucuda koşuyor + skor manipüle edilemez
python3 server/test_rooms_bot_server.py
# Bot motoru paritesi: Python botu = TS botu (birebir)
python3 server/test_bot_parity.py
# İstemci transkript fixture'larını yeniden üret (nadiren gerekir)
node scripts/gen-replay-fixtures.mjs
# Ölü çeviri anahtarı kontrolü (CI'da da koşar — ölü anahtar birikmesin)
npm run check:i18n
```

```bash
python3 server/app.py     # 127.0.0.1:8092 (GAME2048_PORT ile değiştirilebilir)
```

**Dağıtım (sunucu):** systemd servisi (otomatik başlatma + çökünce yeniden
başlatma), nginx yapılandırması, otomatik SQLite yedekleme + geri yükleme, bakım
(VACUUM) ve sağlık kontrolü — tümü [`server/deploy/`](server/deploy/) altında,
adımlar [`server/deploy/README.md`](server/deploy/README.md)'de.

**Mimari not:** Oyun mantığı (`logic/`) Angular'dan tamamen bağımsızdır —
saf fonksiyonlar, girdiyi değiştirmez. Bu sayede hızlı ve güvenilir test edilir.
Kare **id'leri** hamleler arasında korunur; kayma animasyonu bunun üzerine kurulur.

## Hızlı başlat (Windows)

**`oyna.bat`** dosyasına çift tıkla — sunucuyu başlatır ve oyunu tarayıcıda açar
(ilk çalıştırmada paketleri de kurar).

## Kurulum ve geliştirme

**Gereksinim:** [Node.js](https://nodejs.org/) **22.22.3+** (veya 24.15.0+ / 26.0.0+)
— Angular 22 CLI'nin istediği asgari sürüm. `package.json` `engines` ve depodaki
`.nvmrc` bununla tutarlıdır; `nvm` kullanıyorsan `nvm use` doğru sürümü seçer.

```bash
# Bağımlılıkları kur
npm install

# Geliştirme sunucusu → http://localhost:4200/
npm start

# Telefondan test etmek için (aynı Wi-Fi, bilgisayarın IP'si ile)
npx ng serve --host 0.0.0.0
```

## Testler

```bash
npm test
```

**259 test**, hepsi geçiyor. Kapsam ve elle test kontrol listesi: [TEST-NOTES.md](TEST-NOTES.md)

Testlerin bir bölümü **regresyon testidir**: kod denetiminde bulunan hatalar
(geri almanın sayacı yeniden başlatmaması, karıştırma gücünün tahtayı
kilitlemesi, ISO hafta anahtarı çakışması, YZ'nin ilerlemeyi etkilemesi vb.)
düzeltildikten sonra bir daha geri gelmesin diye kilitlendi.

## Derleme ve deploy

```bash
# Üretim derlemesi (kök dizine kurulacaksa)
npm run build

# Alt dizine kurulacaksa base-href gerekir
npx ng build --base-href /emre/2048/
```

Çıktı `dist/game2048/browser/` klasörüne yazılır — statik dosyalar, herhangi bir
web sunucusuyla servis edilebilir. Canlı sürüm bu dosyaların
`/var/www/emre/2048/` altına kopyalanmasıyla yayınlanmıştır.

## Yol haritası

- [x] Proje iskeleti (Angular + SCSS teması)
- [x] Başlık / açılış ekranı
- [x] Izgara veri modeli + signal state
- [x] 4×4 tahta ve kare bileşenleri
- [x] Hamle ve birleştirme mantığı (saf, test edilebilir)
- [x] Rastgele yeni kare üretimi
- [x] Klavye (ok tuşu) + dokunmatik (swipe) kontrolleri
- [x] Skor + en yüksek skor kalıcılığı (localStorage)
- [x] Kazandın / kaybettin ekranları (overlay + "Devam Et")
- [x] Animasyonlar: kayma + pop-in + bump (`prefers-reduced-motion` destekli)
- [x] Geri al (tek adım) + yeni oyun
- [x] Responsive tasarım (mobil / tablet / masaüstü)
- [x] Açık/koyu tema (kalıcı), favicon, meta bilgileri
- [x] Test ve hata ayıklama (100 test)
- [x] **Deploy ve teslim** ✅

### Ek özellikler (Panora iş paketleri)

- [x] Süre ve hamle sayacı (üstte gösterim + sonuç ekranında)
- [x] Ayarlar paneli (⚙️ sağ üstte): müzik, ses seviyeleri, tema
- [x] Arka plan müziği (Pixabay, kalıcı, aç/kapa + ses)
- [x] Ses efektleri (Web Audio ile prosedürel: hamle / birleşme)
- [x] Seviye modu (hedef + geri sayım, ilerledikçe zorlaşır, kayıtlı ilerleme)
- [x] Altın ödül sistemi (seviye tamamlama, kalıcı, ilk tamamlamada ödül)
- [x] Mağaza + güçler (⏰+30sn, 💣bomba, 🔀karıştır, ↩️geri al, 💡ipucu)
- [x] Görevler (günlük + haftalık, tarih tohumlu, altın ödüllü)
- [x] Satın alınabilir temalar (Neon, Okyanus, Orman, Gün Batımı)
- [x] Profil + istatistik (oyun, kazanma %, en iyi kare, seri, toplam hamle)
- [x] Gün serisi (streak) + günlük ödül (seriye göre altın)
- [x] Başarımlar (altın ödüllü hedefler)
- [x] Dil sistemi (TR/EN) — arayüzün tamamı iki dilde
- [x] Hesap sistemi (kayıt/giriş + e-posta, buluta ilerleme senkronu) — Python backend
- [x] Arkadaşlar (ara / istek / kabul / liste)
- [x] Sohbet (emoji'li, yakın-gerçek zamanlı, okunmamış rozeti)
- [x] Çok oyunculu yarış (oda kur, kodla davet, ortak tohumla canlı yarış)
- [x] **Yapay zekâ** (expectimax motoru: öneri, gösterim, bot rakip, hamle
      kalitesi, pozisyon göstergesi, oyun sonu değerlendirmesi)
- [x] Duraklatma (yalnızca tahtayı örten efekt)
- [x] Arayüz düzeni (geniş ekranda tahta + yan panel, isimli güçler)
- [x] Profil yenileme (avatar seçimi, ünvan sistemi, başarım ilerlemesi)
- [x] Kod denetimi ve hata düzeltmeleri (oyun mantığı, arayüz servisleri, backend)
- [x] Skor tablosu (genel + arkadaşlar, kendi sıran dahil)
- [x] Günlük meydan okuma (tarihten türetilen ortak tohum, günlük sıralama)
- [x] Kutlama efektleri (konfeti + prosedürel fanfar sesi)
- [x] İlk oyun rehberi (6 adımlık tanıtım, Ayarlar'dan tekrar açılır)
- [x] 7 günlük ödül takvimi (artan ödül, aralarda güçler, 7. gün büyük ödül)
- [x] Aylık şampiyonluk (her ay sıfırlanan sıralama + ay sonu büyük ödül)
- [x] Oyun sonu hamle zaman çizelgesi ("nerede kaybettin?" — sağlık eğrisi + dönüm
      noktası + tıkla-tahtayı-gör, asistan kapalıyken de çalışır)
- [x] Kişisel LLM koç (oyun sonu; sunucudaki `/analysis`, API anahtarı yalnızca
      sunucuda; maliyet sınırlı; sunucu/anahtar yoksa şablon analize düşer)
- [x] Bot karakterleri (isimli rakipler: Köşeci/Dengeli/Alan Açan/Acelesi Var;
      ölçülmüş güç + yarış içi laf atma + karakter bazlı galibiyet; TS↔Python parite)
- [x] Uyarlanabilir zorluk ("Bana uygun rakip": son N skorun kayan penceresi,
      boyut bazında eşleştirme, kademeli değişim; elle seçim korunur)
