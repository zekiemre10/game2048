# 2048 — Test Notları

Son güncelleme: 2026-07-13

## Özet

| Alan | Durum |
|------|-------|
| Otomatik birim/bileşen testleri | ✅ **81/81 geçiyor** (`ng test`) |
| Production build | ✅ Hatasız (`ng build`, ~138 kB) |
| Bulunan kritik hata | ✅ Kalmadı (aşağıda 3 hata bulundu ve giderildi) |
| Gerçek cihaz/tarayıcı testi | ⏳ Kısmen — aşağıdaki kontrol listesi elle yapılmalı |

---

## 1. Otomatik testler (81)

Çalıştırmak için: `ng test`

### Saf hamle mantığı — `board-logic.spec.ts` (28)

| Senaryo | Beklenen | Durum |
|---------|----------|-------|
| `2 2 4` → `4 4` | Zincirleme birleşme YOK | ✅ |
| `2 2 2 2` → `4 4` | Çift birleşme yok (8 değil) | ✅ |
| `4 4 4` → `8 4` | İlk çift birleşir | ✅ |
| `4 4 4 4` → `8 8` | İki ayrı birleşme | ✅ |
| **SOL:** `2 2 2` → `4 2` | İtilen kenara **en yakın** çift birleşir | ✅ |
| **SAĞ:** `2 2 2` → `2 4` | Sağdaki çift birleşir | ✅ |
| **YUKARI:** `2 2 2` → `4 2` | Üstteki çift birleşir | ✅ |
| **AŞAĞI:** `2 2 2` → `2 4` | Alttaki çift birleşir | ✅ |
| 4 yönde kaydırma | Doğru sıkışma | ✅ |
| Birleşmeyen dolu satır | `moved = false` (geçersiz hamle) | ✅ |
| Boş tahtada hamle | `moved = false` | ✅ |
| Skor toplamı (`2 2 4 4`) | `gained = 12` | ✅ |
| Tüm satırlar aynı anda birleşir | Skor doğru toplanır | ✅ |
| Saflık | Girdi dizisi/nesneleri **değişmez** | ✅ |
| id sürekliliği | Kayan/birleşen kare id'sini korur | ✅ |
| Oyun sonu tespiti | Kilitli tahtada `hasAnyMove = false` | ✅ |

### Oyun servisi — `game.service.spec.ts` (43)

- **Izgara/state:** boş ızgara 4×4, başlangıçta 2 rastgele kare, `grid` signal senkron
- **Rastgele kare:** yalnızca geçerli hamleden sonra; dolu ızgaraya eklenmez; **2/4 oranı ~%90/%10** (4000 örneklik istatistiksel test)
- **Skor:** birleşme skoru artırır; en yüksek skor **localStorage'a kaydedilir ve geri yüklenir**; yeni oyun skoru sıfırlar ama rekoru korur
- **Kazanma:** 2048 oluşunca `Won`; "Devam Et" oyuna döner ve kazanmayı **tekrar tetiklemez**
- **Kaybetme:** hamle kalmayınca `Lost`; oyun bitince **giriş kilitli**
- **Geri al:** tahta + skor birebir geri gelir; **tek adım**; geçersiz hamle geçmişe yazılmaz; kaybettiren hamle geri alınabilir; **rekor geri alınmaz**
- **Uçtan uca:** 300 rastgele hamle boyunca değişmezler korunur →
  üst üste binen kare yok, id çakışması yok, tüm değerler 2'nin kuvveti,
  skor asla azalmaz, kare sayısı ≤ 16. Oyun her zaman `Won`/`Lost` ile biter (asılı kalmaz).

### Bileşenler — `board.spec.ts` (7), `theme.service.spec.ts` (5), `app.spec.ts` (2)

- 16 zemin hücresi; her kare için bir `app-tile`
- Kareler doğru `--row`/`--col` ile konumlanır
- Farklı değerler farklı renk (`data-value`)
- `is-new` (pop-in) ve `is-merged` (bump) sınıfları uygulanır
- **id korunduğunda DOM elemanı aynı kalır** → kayma animasyonunun önkoşulu
- Tema: toggle çalışır, `<html data-theme>` yazılır, localStorage'a kaydedilir ve geri yüklenir

---

## 2. Bulunan ve giderilen hatalar

### 🐛 #1 — Tema butonu skor kutusunun üstüne biniyordu (dar ekran)
**Belirti:** Tema butonu `position: fixed` ile viewport'un sağ üstünde. Dar ekranda (< 640px) oyun alanı tam genişliği kapladığı için **EN İYİ** skor kutusu da sağ kenara dayanıyor ve butonun altında kalıyordu.
**Neden:** Sabit konumlu buton, akıştaki topbar ile aynı bölgeyi paylaşıyordu. Geniş ekranda oyun ortalı/sınırlı (500px) olduğu için çakışma görünmüyordu — sadece mobilde ortaya çıkıyordu.
**Çözüm:** `@media (max-width: 640px)` altında topbar'a butona yer açan `padding-right: 52px` eklendi.

### 🐛 #2 — Koyu temada kare metinleri okunmaz olacaktı
**Belirti:** Renkleri CSS değişkenine çevirirken kare metin renkleri de temaya bağlanmıştı.
**Neden:** Kare paleti (krem "2", "4") **sabit**; metin `var(--color-text)` olunca koyu temada **açık metin krem zemin üstünde** kalıp okunmaz oluyordu.
**Çözüm:** Kare metin renkleri temadan bağımsız sabit tutuldu (gerçek karelerde ve başlık ekranı önizlemesinde).

### 🐛 #3 — Birleşme animasyonu üst üste birleşmelerde tekrar çalışmıyordu
**Belirti:** Aynı kare iki hamlede arka arkaya birleşirse ikinci "bump" animasyonu oynamıyordu.
**Neden:** CSS sınıfı zaten ekli kaldığı için tarayıcı animasyonu yeniden başlatmıyordu.
**Çözüm:** Sınıf kaldırılıp reflow tetiklenerek yeniden ekleniyor. Ayrıca renkler `[class]` bağlaması yerine `[data-value]` attribute'una taşındı (bağlama, imperatif eklenen sınıfı ezmesin diye).

### ℹ️ Hata sanılan ama hata olmayan
Tarayıcıda görünen `TS2339: Property 'updateBestScore' does not exist` overlay'i, geliştirme sırasında oluşan **anlık bir ara duruma** ait bayat bir mesajdı. Kod doğruydu; sayfa yenilenince kayboldu. (`ng build` temiz.)

---

## 3. Canlı site duman testi (otomatik) ✅

Gerçek Chrome ile **canlı adres** sürüldü (Playwright):
http://34.158.136.9/emre/2048/

| Adım | Sonuç |
|------|-------|
| Sayfa yükleniyor (HTTP 200, varlıklar 200) | ✅ |
| "Başla" tıklanıyor → tahta çiziliyor | ✅ |
| 10 ok tuşu hamlesi → kareler kayıyor/birleşiyor | ✅ |
| Skor işliyor (16 / 28 / 36 ölçüldü) | ✅ |
| Açık tema, koyu tema, mobil (390px) görünümleri | ✅ (ekran görüntüleri `docs/`) |
| **Hata #1 doğrulaması:** mobilde tema butonu skor kutusuna binmiyor | ✅ |
| **Hata #2 doğrulaması:** koyu temada kare metinleri okunuyor | ✅ |
| Airport Manager (`/emre/`) hâlâ çalışıyor — bozulmadı | ✅ |

## 4. Elle test edilecekler (kontrol listesi)

Otomatik testler mantığı kapsıyor; aşağıdakiler **gerçek cihazda/tarayıcıda** doğrulanmalı.

**Canlı:** http://34.158.136.9/emre/2048/ &nbsp;•&nbsp; **Yerel:** http://localhost:4200/

### Ana senaryolar
- [ ] Başla → tahtada 2 kare çıkıyor
- [ ] Ok tuşlarıyla kareler kayıyor, aynı sayılar birleşiyor, skor artıyor
- [ ] Her geçerli hamlede yeni kare beliriyor; **geçersiz hamlede belirmiyor**
- [ ] "↶ Geri Al" son hamleyi geri alıyor; ikinci kez basılamıyor (devre dışı)
- [ ] "Yeni Oyun" temiz başlatıyor (skor 0, 2 kare)
- [ ] Hamle kalmayınca "Oyun Bitti" overlay'i çıkıyor; oradan geri alınabiliyor
- [ ] 2048'e ulaşınca "Kazandın 🎉" + "Devam Et" çalışıyor
- [ ] Rekor (EN İYİ) sayfayı kapatıp açınca korunuyor

### Tema
- [ ] 🌙/☀️ butonu temayı değiştiriyor
- [ ] Sayfayı yenileyince tema hatırlanıyor
- [ ] Koyu temada tüm metinler okunabiliyor (özellikle "2" ve "4" kareleri)
- [ ] Koyu temada sayfa açılırken beyaz parlama (FOUC) yok

### Mobil / responsive
- [ ] Telefonda **yatay kaydırma yok**
- [ ] Parmakla kaydırma (swipe) 4 yönde çalışıyor
- [ ] Tahta üzerinde kaydırırken sayfa scroll olmuyor
- [ ] Tema butonu skor kutularının üstüne binmiyor *(hata #1 — düzeltildi, doğrula)*
- [ ] Telefonu yatay çevirince tahta ekrana sığıyor
- [ ] Butonlara basmak rahat (44px hedef)

### Tarayıcılar
- [ ] Chrome / Edge
- [ ] Firefox
- [ ] Safari (iPhone)

> Not: `aspect-ratio`, `clamp()`, CSS custom properties ve `:focus-visible` kullanılıyor —
> hepsi güncel tarayıcılarda desteklenir. `100svh` desteklenmeyen tarayıcıda `100vh`'ye düşer.
