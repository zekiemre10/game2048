// ============================================================
//  Ortam yapılandırması — ÜRETİM (varsayılan build hedefi).
//
//  apiBase artık koda gömülü bir IP/protokol DEĞİL: same-origin GÖRELİ yoldur.
//  Frontend `https://<alanadı>/emre/2048/` altında, API aynı origin'de
//  `/emre/2048/api` altında sunulur → API çağrısı sayfanın protokolünü miras
//  alır (sayfa HTTPS ise API de HTTPS). Böylece:
//    • sabit `http://IP` kaldırıldı (sunucu taşınırsa kod değişmez),
//    • karışık içerik (mixed content) uyarısı OLMAZ,
//    • HTTPS'e geçişte hiçbir kod değişikliği gerekmez.
//
//  Yerel geliştirmede environment.development.ts devreye girer (bkz. angular.json
//  fileReplacements) ve `/api` → localhost:8092 proxy'sine gider (proxy.conf.json).
// ============================================================
export const environment = {
  production: true,
  apiBase: '/emre/2048/api',
};
