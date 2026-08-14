import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';

describe('I18nService — tembel yükleme + yedek', () => {
  beforeEach(() => {
    localStorage.clear();
    try {
      history.replaceState(null, '', '/'); // ?lang= testler arasına sızmasın
    } catch {
      /* jsdom yoksa yoksay */
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function fresh(): I18nService {
    return TestBed.inject(I18nService);
  }

  it('t() dile göre doğru metni verir (dosya tembel yüklendikten sonra)', async () => {
    const s = fresh();
    s.set('tr');
    await s.ready();
    expect(s.t('btn.close')).toBe('Kapat');
    s.set('en');
    await s.ready();
    expect(s.t('btn.close')).toBe('Close');
  });

  it('t() yer tutucuları doldurur', async () => {
    const s = fresh();
    s.set('en');
    await s.ready();
    expect(s.t('ov.levelDoneTitle', { n: 3 })).toBe('Level 3 Complete! 🎉');
    expect(s.t('ov.goldWon', { g: 50 })).toBe('+50 gold earned!');
  });

  it('model metinleri de aynı sistemde (L() değil, t(anahtar))', async () => {
    const s = fresh();
    s.set('tr');
    await s.ready();
    expect(s.t('ach.tile-512.name')).toBe('512 Kulübü');
    expect(s.t('power.time.name')).toBe('+30 Saniye');
    expect(s.t('rank.novice.name')).toBe('Çırak');
    s.set('en');
    await s.ready();
    expect(s.t('ach.tile-512.name')).toBe('512 Club');
    expect(s.t('rank.novice.name')).toBe('Novice');
  });

  it('bilinmeyen anahtar anahtarın kendisini döndürür (son yedek)', async () => {
    const s = fresh();
    await s.init();
    expect(s.t('yok.boyle.anahtar')).toBe('yok.boyle.anahtar');
  });

  it('dil tercihi kalıcı (localStorage) ve yeniden okununca korunur', () => {
    fresh().set('en');
    expect(localStorage.getItem('game2048.lang')).toBe('en');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(I18nService).lang()).toBe('en');
  });

  it('<html lang> güncellenir (dil değişimi anlık)', () => {
    const s = fresh();
    s.set('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    s.set('tr');
    expect(document.documentElement.getAttribute('lang')).toBe('tr');
  });

  it('set() dili URL ?lang= olarak yansıtır (paylaşılan link doğru dilde açılır)', () => {
    const s = fresh();
    s.set('en');
    expect(new URLSearchParams(location.search).get('lang')).toBe('en');
    s.set('tr');
    expect(new URLSearchParams(location.search).get('lang')).toBe('tr');
  });

  it('URL ?lang= başlangıç dilini belirler (kayıtlı tercihi ezer)', () => {
    localStorage.setItem('game2048.lang', 'tr');
    history.replaceState(null, '', '/?lang=en');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(I18nService).lang()).toBe('en');
  });
});
