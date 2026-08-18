# 2048 — Tasarım sistemi (ekip notu)

Amaç: yeni ekranlar **"sıfırdan uydur"** yerine **"sistemden türet"**. Ortak
renk/kare/tipografi/bileşen kaynağı artık var.

## Nerede

- **Kaynak tokenlar (kod):** `src/styles/_variables.scss` (kare paleti, yarıçap,
  boşluk, tipografi) + `src/styles/_base.scss` (6 temanın CSS değişkenleri).
- **Görsel kütüphane (kartlar):** `design-system/` — her dosya **kendi kendine
  yeten** bir HTML önizleme (tokenlar inline; panelde uygulamanın CSS'i yok).
- **Claude Design panosu:** claude.ai/design → **"2048 Design System"** projesi.
  Kartlar burada grup grup görünür: Renkler · Tipografi · Boşluk · Temalar ·
  Kareler · Butonlar.

## Kartlar nasıl üretiliyor

Her önizleme HTML'inin **İLK SATIRI** bir işaret taşır — gruplandırmayı bu sağlar:

```html
<!-- @dsCard group="Butonlar" -->
```

Panodaki `_ds_manifest.json` bu işaretlerden derlenir; ayrı kayıt gerekmez.

**İki kural (yoksa kart bozulur):**
1. `@dsCard` **ilk satırda** olmalı.
2. Önizleme **inline token** içermeli (renkleri/fontu `<style>` içine göm) —
   panoda projenin SCSS'i yüklenmez.

## Yeni bileşen ekleme

1. `design-system/components/<ad>.html` yaz; ilk satır `<!-- @dsCard group="…" -->`.
2. Tokenları inline ver (mevcut kartlardan kopyala; gerçek hex `_variables.scss`'te).
3. Senkron: `/design-sync` (Claude Code) — **artımlı**, bileşen bileşen; toptan
   değiştirme YOK. Push sonrası panoda doğru göründüğünü kontrol et.

## Senkron (Claude Code)

- Erişim: `/design-login` (bir kez). Proje **design-system tipinde** açılır;
  normal projeye push onu tasarım sistemine ÇEVİRMEZ (tip sonradan değişmez).
- `/design-sync` yerel `design-system/` ile pano projesini eşler.

## frontend-design becerisi

Yeni bir ekran/bileşen tasarlarken (görsel yön + tipografi + şablon-görünümünden
kaçınma) `frontend-design` becerisini çağır — doğru anda tetiklenmesi yeterli,
kurulum gerektirmez. Örnek elden geçirme: `docs/design/overlay-before.png` →
`overlay-after.png` (oyun-sonu overlay'inde "Sonraki Seviye" düğmesi kırpılıyordu;
eylemler yukarı alınıp panel kaydırılabilir yapıldı).

## İlgili

- `.claude/CLAUDE.md` — proje bağlamı (mimari, komutlar, dağıtım).
- Sonraki iş: **OYUN-236** (monoliti böl) — `app.scss` 2.859 / `app.html` 1.743
  satır; tokenlar + tekrar eden parçalar bu kütüphaneye çıkarıldıkça monolit erir.
