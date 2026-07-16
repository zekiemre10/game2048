import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { GameService } from './game.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function fresh(): ThemeService {
    return TestBed.inject(ThemeService);
  }

  it('varsayılan olarak açık/koyu sahip olunur', () => {
    const s = fresh();
    expect(s.isOwned('light')).toBe(true);
    expect(s.isOwned('dark')).toBe(true);
    expect(s.isOwned('neon')).toBe(false);
  });

  it('sahip olunan tema seçilebilir ve DOM’a uygulanır', () => {
    const s = fresh();
    s.select('dark');
    expect(s.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sahip olunmayan tema seçilemez', () => {
    const s = fresh();
    s.select('neon'); // sahip değil
    expect(s.theme()).not.toBe('neon');
  });

  it('yetersiz altınla tema satın alınamaz', () => {
    const game = TestBed.inject(GameService);
    game.gold.set(50);
    const s = fresh();
    expect(s.buyTheme('neon')).toBe(false); // neon 200
    expect(s.isOwned('neon')).toBe(false);
  });

  it('yeterli altınla tema satın alınır, altın düşer, otomatik seçilir', () => {
    const game = TestBed.inject(GameService);
    game.gold.set(500);
    const s = fresh();
    expect(s.buyTheme('neon')).toBe(true);
    expect(game.gold()).toBe(300); // 500 - 200
    expect(s.isOwned('neon')).toBe(true);
    expect(s.theme()).toBe('neon');
  });

  it('satın alınan tema ve seçim kalıcı', () => {
    const game = TestBed.inject(GameService);
    game.gold.set(500);
    fresh().buyTheme('ocean');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const s2 = TestBed.inject(ThemeService);
    expect(s2.isOwned('ocean')).toBe(true);
    expect(s2.theme()).toBe('ocean');
  });
});
