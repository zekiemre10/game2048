# 2048 — Faz-2 özellik doğrulama raporu (paket 238–249)

Bu belge, oynanışa dokunan özelliklerin **ne yaptığını + nasıl doğrulandığını**
tek tek belgeler. Doğrulama **otomatik**: her özelliğin spec testi ve/veya ölçüm
scripti var; tüm suite yeşil. Ölçülebilir olanlar bu turda **yeniden koşuldu**,
gerçek çıktı aşağıda.

**Suite durumu (bu turda koşuldu):**
- Frontend birim/bileşen: **333/333 geçti** (`ng test`, 41 dosya)
- Backend: **14/14 dosya geçti** (`python server/run_tests.py`) — geçici DB;
  test hesapları çalışma sonunda **otomatik silinir** (kalıcı veri bırakmaz)
- i18n bütünlüğü: **407 anahtar × 2 dil, 0 eksik/fazla/ölü/tanımsız**

> **Dürüstlük notu:** Bu doğrulamalar spec + ölçüm bazlıdır; her özelliği bu
> turda canlı tarayıcıda elle oynamadım (uygulama şu an yerelde çalışmıyor).
> Deploy sonrası elle tıklama turu yapılabilir. Aşağıdaki her satır, çekirdek
> davranışı kanıtlayan **gerçek testi** ve koştuğumda **aldığım sonucu** verir.

| # | Özellik | Ne yapar | Nasıl doğrulandı → sonuç |
|---|---------|----------|--------------------------|
| **238** | Hamle zaman çizelgesi | Oyun sonunda hamle-başına pozisyon-sağlığı grafiği; hatalı hamleler işaretli, en sert düşüş "dönüm noktası" vurgulu | `ai-review.spec.ts` + `game.service.review.spec.ts` sağlık eğrisi + dönüm noktası hesabını hamle günlüğünden doğrular → **geçti** |
| **239** | LLM koç | Oyun özeti → sunucu `/analysis` → kısa değerlendirme (anahtar yalnız sunucuda, günlük sınır) | `server/test_analysis.py`: token yok → **401**, burst aşımı → **429**, girişliye şablon-dışı yanıt → **geçti** |
| **240** | Bot karakterleri | 4 kişilikli bot (Köşeci/Dengeli/Alan Açan/Acelesi Var), çok oyunculuda **sunucuda**, aynı tohumla | `test_bot_parity.py` + `test_rooms_bot_character.py` istemci↔sunucu **birebir** oynadığını, `ai-characters.spec.ts` ağırlık setlerini → **geçti** |
| **241** | Uyarlanabilir zorluk | Son oyun ortalamana kıl payı yarışan bot rung'ı eşler, kademeli | `adaptive-ladder-bench.mjs` **koşuldu** → easy 3520 · medium 18.8k · hard 32k · corner 41.5k · expert 60.9k; eşleme banda oturuyor. `ai-adaptive.spec.ts`+`profile.adaptive.spec.ts` tek-basamak sınırı → **geçti** |
| **242** | Bulmaca modu | 42 deterministik bulmaca (hedef/skor/kurtarma); çözülebilirlik + asgari hamle **üretimde tam aramayla (BFS/DFS)** kanıtlı | `gen-puzzles.mjs` üretimde doğrular; `puzzle.service.spec.ts`+`puzzles.spec.ts` çözüm/derece mantığı → **geçti** |
| **243** | Günlük tohum küratörü | YZ aday tohumları oynatıp ölçüt (avg≥6000 & spread≥4000) geçenleri ≥1 yıllık takvime yazar | `server/test_daily_calendar.py` determinizmi (istemci TS ↔ sunucu JSON) doğrular; `daily-challenge.spec.ts` istemci → **geçti** |
| **244** | i18n bölme | Sözlük dile-göre JSON'a bölünüp tembel yüklenir | `check-i18n.mjs` **koşuldu** → 2 dil, **407 anahtar, 0 sorun** (CI kapısı); `i18n.service.spec.ts` lazy+fallback → **geçti** |
| **245** | Çok dilli SEO | Başlık/açıklama/canonical/hreflang/og-twitter dile göre | `seo.service.spec.ts`: TR og:locale **tr_TR** + alternate **en_US**, EN og:title **"2048 — Number Merge Puzzle"**, dil değişince başlık **anlık** → **geçti** |
| **248** | Test kapsamı | Backend kapsamı genişletildi | `test_account_delete.py` ("Hesabı sil"in canlıda **404** verdiğini yakaladı → endpoint eklenip düzeltildi) + `test_admin.py`; backend 14 dosya, frontend 333 spec → **hepsi yeşil** |
| **249** | README/belgeler | Belgeler gerçek duruma çekildi | Ölçülmüş YZ merdiveni, mimari, asgari Node 22.22.3, `server/README.md` (tam uç listesi), `server/ADMIN.md`, gizlilik/veri bölümü; YZ sayıları `ai-bench` ölçümüne dayanır |

## Test hesapları / veri hijyeni

Backend entegrasyon testleri **geçici bir SQLite DB** (`tempfile`) ile kendi
sunucusunu ayağa kaldırır; oluşturulan tüm test kullanıcıları/verisi çalışma
bitince dosya silinerek **temizlenir** (üretim `app.db`'ye asla dokunulmaz).
Ayrıntı: her `server/test_*.py` başlığı.
