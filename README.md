# 2048 — Angular

Klasik **2048** oyununun Angular ile yeniden yazımı. Standalone bileşen mimarisi, SCSS teması ve signal tabanlı durum yönetimi kullanır.

> Durum: 🚧 Geliştirme aşamasında — şu an başlık ekranı ve proje iskeleti hazır. Oyun tahtası ve hamle mantığı sonraki adımlarda eklenecek.

## Nasıl oynanır

- Ok tuşlarıyla (↑ ↓ ← →) taşları kaydır.
- Aynı sayıya sahip iki taş çarpışınca birleşir ve değerleri toplanır.
- Amaç **2048** taşına ulaşmak.
- Hamle kalmayınca oyun biter.

## Teknolojiler

- [Angular 22](https://angular.dev/) — standalone bileşenler
- TypeScript
- SCSS (merkezi renk değişkenleri)
- Angular Signals (durum yönetimi)

## Proje yapısı

```
src/
  app/
    components/        # Arayüz bileşenleri (start-screen, ...)
    services/          # Oyun mantığı ve durum (game.service)
    models/            # Tip tanımları (Tile, Direction, GameStatus)
    app.ts / .html     # Kök bileşen
  styles/
    _variables.scss    # Renk paleti ve tasarım token'ları
    _base.scss         # Global temel stiller
  styles.scss          # Global stil giriş noktası
```

## Hızlı başlat (Windows)

En kolayı: **`oyna.bat`** dosyasına çift tıkla. Sunucuyu başlatır ve oyunu
tarayıcıda otomatik açar (ilk çalıştırmada paketleri de kurar).

## Geliştirme

Bağımlılıkları kur ve geliştirme sunucusunu başlat:

```bash
npm install
ng serve
```

Ardından tarayıcıdan `http://localhost:4200/` adresine git. Kaynak dosyaları değiştirdikçe uygulama otomatik yenilenir.

## Derleme

```bash
ng build
```

Çıktı `dist/` klasörüne yazılır.

## Testler

```bash
ng test
```

**81 test**, hepsi geçiyor. Kapsam ve elle test kontrol listesi için:
[TEST-NOTES.md](TEST-NOTES.md)

## Yol haritası

- [x] Proje iskeleti (Angular + SCSS teması)
- [x] Başlık / açılış ekranı
- [x] Izgara veri modeli + signal state (2 başlangıç karesi)
- [x] 4×4 tahta görünümü
- [x] Hamle ve birleştirme mantığı (saf, test edilebilir)
- [x] Klavye (ok tuşu) + dokunmatik (swipe) kontrolleri
- [x] Oyun sonu tespiti + giriş kilidi
- [x] Skor + en yüksek skor kalıcılığı (localStorage)
- [x] Kazandın / kaybettin ekranları (overlay + "Devam Et")
- [x] Animasyonlar: kayma + pop-in + bump (`prefers-reduced-motion` destekli)
- [x] Geri al (tek adım) + yeni oyun
- [x] Responsive tasarım (mobil / tablet / masaüstü)
- [x] Açık/koyu tema (kalıcı), favicon, meta bilgileri
