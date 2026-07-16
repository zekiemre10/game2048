import { TestBed } from '@angular/core/testing';
import { AudioService } from './audio.service';

describe('AudioService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function fresh(): AudioService {
    return TestBed.inject(AudioService);
  }

  it('varsayılan: müzik açık, ses %40', () => {
    const s = fresh();
    expect(s.musicOn()).toBe(true);
    expect(s.volume()).toBeCloseTo(0.4);
  });

  it('toggleMusic müziği tersine çevirir ve kaydeder', () => {
    const s = fresh();
    s.toggleMusic();
    expect(s.musicOn()).toBe(false);
    expect(localStorage.getItem('game2048.musicOn')).toBe('false');

    s.toggleMusic();
    expect(s.musicOn()).toBe(true);
    expect(localStorage.getItem('game2048.musicOn')).toBe('true');
  });

  it('setVolume 0..1 aralığına sıkıştırır ve kaydeder', () => {
    const s = fresh();
    s.setVolume(0.7);
    expect(s.volume()).toBeCloseTo(0.7);
    expect(localStorage.getItem('game2048.musicVolume')).toBe('0.7');

    s.setVolume(5); // aşırı değer
    expect(s.volume()).toBe(1);

    s.setVolume(-3);
    expect(s.volume()).toBe(0);
  });

  it('kayıtlı tercihler yeni serviste geri yüklenir', () => {
    localStorage.setItem('game2048.musicOn', 'false');
    localStorage.setItem('game2048.musicVolume', '0.25');

    const s = fresh();
    expect(s.musicOn()).toBe(false);
    expect(s.volume()).toBeCloseTo(0.25);
  });
});
