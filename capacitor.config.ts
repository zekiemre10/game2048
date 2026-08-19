import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor yapılandırması — 2048 mobil (Android/iOS).
 *
 * - `webDir`: Angular 17+ çıktıyı `dist/<uygulama>/browser` altına koyar.
 * - `androidScheme: 'https'` → WebView kökeni `https://localhost` olur; sunucu
 *   CORS'una bu köken eklendi (app.py `_DEFAULT_ORIGINS`). API zaten MUTLAK HTTPS
 *   (`https://2048.aicirkit.com/api`) olduğu için düz-HTTP (cleartext) engeli YOK.
 * - base href oyunda `/` (koke tasindi) → mobil derlemede `--base-href` bayrağı
 *   VERİLMEZ; `ng build` çıktısı web ile aynı.
 */
const config: CapacitorConfig = {
  appId: 'com.aicirkit.game2048',
  appName: '2048',
  webDir: 'dist/game2048/browser',
  android: {
    // Karışık içerik yok; her şey HTTPS. Cleartext gerekmiyor (Android 9+ bloku).
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#faf8ef', // açık tema arka planı
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
