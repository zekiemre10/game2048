import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { PwaService } from './pwa.service';

describe('PwaService — çevrimdışı / kurulum / güncelleme', () => {
  let pwa: PwaService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      // SW devre dışı → SwUpdate no-op sağlanır (test ortamı).
      providers: [provideServiceWorker('ngsw-worker.js', { enabled: false })],
    });
    pwa = TestBed.inject(PwaService);
  });

  it('online sinyali navigator.onLine ile başlar (jsdom: çevrimiçi)', () => {
    expect(pwa.online()).toBe(true);
  });

  it('offline olayı → online false; online olayı → geri true', () => {
    window.dispatchEvent(new Event('offline'));
    expect(pwa.online()).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(pwa.online()).toBe(true);
  });

  it('beforeinstallprompt yakalanınca installable=true (kurulum daveti hazır)', () => {
    expect(pwa.installable()).toBe(false);
    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(pwa.installable()).toBe(true);
  });

  it('başlangıçta güncelleme yok (updateReady=false)', () => {
    expect(pwa.updateReady()).toBe(false);
  });
});
