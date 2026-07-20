import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function fresh(): I18nService {
    return TestBed.inject(I18nService);
  }

  it('t() dile göre doğru metni verir', () => {
    const s = fresh();
    s.set('tr');
    expect(s.t('btn.close')).toBe('Kapat');
    s.set('en');
    expect(s.t('btn.close')).toBe('Close');
  });

  it('t() yer tutucuları doldurur', () => {
    const s = fresh();
    s.set('en');
    expect(s.t('ov.levelDoneTitle', { n: 3 })).toBe('Level 3 Complete! 🎉');
    expect(s.t('ov.goldWon', { g: 50 })).toBe('+50 gold earned!');
  });

  it('L() model verisini dile göre seçer', () => {
    const s = fresh();
    s.set('tr');
    expect(s.L('Açık', 'Light')).toBe('Açık');
    s.set('en');
    expect(s.L('Açık', 'Light')).toBe('Light');
  });

  it('dil tercihi kalıcı (localStorage)', () => {
    fresh().set('en');
    expect(localStorage.getItem('game2048.lang')).toBe('en');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(I18nService).lang()).toBe('en');
  });

  it('bilinmeyen anahtar anahtarın kendisini döndürür', () => {
    expect(fresh().t('yok.boyle.anahtar')).toBe('yok.boyle.anahtar');
  });

  it('<html lang> güncellenir', () => {
    const s = fresh();
    s.set('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    s.set('tr');
    expect(document.documentElement.getAttribute('lang')).toBe('tr');
  });
});
