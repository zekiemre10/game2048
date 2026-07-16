import { TestBed } from '@angular/core/testing';
import { SfxService } from './sfx.service';

describe('SfxService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function fresh(): SfxService {
    return TestBed.inject(SfxService);
  }

  it('varsayılan efekt sesi %50', () => {
    expect(fresh().sfxVolume()).toBeCloseTo(0.5);
  });

  it('setVolume 0..1 aralığına sıkıştırır ve kaydeder', () => {
    const s = fresh();
    s.setVolume(0.8);
    expect(s.sfxVolume()).toBeCloseTo(0.8);
    expect(localStorage.getItem('game2048.sfxVolume')).toBe('0.8');

    s.setVolume(9);
    expect(s.sfxVolume()).toBe(1);
    s.setVolume(-1);
    expect(s.sfxVolume()).toBe(0);
  });

  it('kayıtlı efekt sesi geri yüklenir', () => {
    localStorage.setItem('game2048.sfxVolume', '0.3');
    expect(fresh().sfxVolume()).toBeCloseTo(0.3);
  });

  it('Web Audio olmayan ortamda çalmak hata vermez', () => {
    const s = fresh();
    // jsdom'da AudioContext yok → sessizce geçmeli
    expect(() => {
      s.playMove();
      s.playMerge();
    }).not.toThrow();
  });
});
