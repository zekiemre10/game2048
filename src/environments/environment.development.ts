// ============================================================
//  Ortam yapılandırması — YEREL GELİŞTİRME.
//
//  `ng serve` (development) bu dosyayı kullanır (angular.json fileReplacements).
//  apiBase `/api`'dir ve proxy.conf.json bunu yerel sunucuya (127.0.0.1:8092)
//  yönlendirir. Böylece geliştirirken ÜRETİM sunucusuna/veritabanına ASLA
//  bağlanılmaz — kendi `python server/app.py`'nize konuşursunuz.
// ============================================================
export const environment = {
  production: false,
  apiBase: '/api',
};
