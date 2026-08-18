# 2048 — Gizlilik ve veri sorumluluğu (envanter)

Bu belge **kodun gerçekte yaptığının kaydıdır** — oyundaki kullanıcı-dostu
politika (`components/privacy-panel`) bununla birebir tutulur. 2048, üç oyun
arasında kişisel veri tutan tek oyundur; bu yüzden veri sorumluluğu gerçek bir
iş kalemidir.

> **İlke:** Toplanmayan veri, korunması gerekmeyen veridir. Mümkün olan en az
> veri tutulur.

## Toplanan kişisel veri envanteri

| Veri | Nerede | Neden | Zorunlu? |
|------|--------|-------|----------|
| Kullanıcı adı | `users.username` | Kimlik, sıralama, arkadaşlık | Evet |
| Parola | `users.pwhash`+`salt` (PBKDF2 600k, geri döndürülemez) | Kimlik doğrulama | Evet |
| **E-posta** | `users.email` | Gelecekte hesap kurtarma | **HAYIR (isteğe bağlı)** ¹ |
| Oyun ilerlemesi | `users.data` (JSON) | Oyunun kendisi | Evet (oyun verisi) |
| Arkadaşlıklar | `friendships` | Sosyal özellik | Kullanıcı eylemi |
| Özel mesajlar | `messages` | Sohbet | Kullanıcı eylemi |
| Skorlar | `monthly_scores`, `daily_scores` | Sıralama/yarış | Oyun eylemi |
| Anonim olaylar | `events` (user_id/İP YOK) | Denge/metrik | Anonim |
| Aktiflik | `user_activity` (user_id, gün) | Metrik (DAU/tutunma) | Dışa açılmaz |

¹ **E-posta kararı (bu pakette değerlendirildi):** e-posta şu an hiçbir işlevde
kullanılmıyor (mail gönderimi/doğrulama/parola sıfırlama YOK) — yalnız yöneticiye
gösteriliyordu. "Kullanılmayan veri toplanmaz" ilkesiyle **kayıt artık e-posta
İSTEMEZ** (isteğe bağlı; verilirse biçimi doğrulanır). İleride büsbütün kaldırılabilir.

## Saklama süreleri (otomatik temizlik — `retention_cleanup`, saatlik daemon)

| Veri | Süre | Sabit |
|------|------|-------|
| Özel mesajlar | 180 gün | `RETENTION_MESSAGES_DAYS` |
| Anonim olaylar | 90 gün | `RETENTION_EVENTS_DAYS` |
| Çözülmüş şikayetler | 180 gün | `RETENTION_RESOLVED_REPORTS_DAYS` |
| Moderasyon bildirimleri | 365 gün | `RETENTION_MOD_NOTICES_DAYS` |
| Yönetici denetim kaydı | 365 gün | `RETENTION_AUDIT_DAYS` |
| Oyun odaları | ~6 saat | `reap_stale_rooms` |
| Oturumlar | 90 gün TTL | `TOKEN_TTL` |
| Hesap + ilerleme | Kullanıcı silene kadar | — |

## Kim neye erişebilir (kod = politika)

- **Kullanıcı:** kendi verisini indirir (`GET /account/export`), hesabını siler
  (`POST /account/delete`, parola onaylı).
- **Yönetici:** hesap bilgisi (parola HARİÇ), skorlar, hakkındaki şikayet/moderasyon
  geçmişi; gerekçe **zorunlu** + **denetimli** moderasyon. **Parola hash'i dönmez**
  (açık SELECT), **kimliğe bürünme yok** (oturum yalnız parolayla). Bkz. `ADMIN.md`.
- **Sohbet:** yönetici serbest okuyamaz; yalnız şikayet edilen mesaj ±3'ü
  (`_admin_report_context`, `CTX=3`), denetime yazılır.

## Hesap silindiğinde (kod: `_delete_account`)

Kalıcı silinir: `users`, `messages` (iki yön), `friendships`, `blocks`,
`monthly/daily_scores`, `monthly_prizes`, `flagged_submissions`, `reports`,
`mod_notices`, `user_activity`, `sessions`. Kullanıcı adı yeniden serbest kalır.
Geri alınamaz.

## Tutarlılık kuralı

Panel yetkileri veya saklama süreleri değişirse **hem kod hem bu belge hem
`privacy-panel` metni** birlikte güncellenmelidir. Yazılan ile kodun yaptığı
ayrışmamalıdır. Testler: `test_privacy.py` (e-posta opsiyonel + self-export +
saklama temizliği + silme kapsamı).
