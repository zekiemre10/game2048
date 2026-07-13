import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  function freshService(): ThemeService {
    return TestBed.inject(ThemeService);
  }

  it('kayıt yoksa varsayılan tema belirlenir ve DOM’a uygulanır', () => {
    const service = freshService();
    expect(['light', 'dark']).toContain(service.theme());
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      service.theme(),
    );
  });

  it('toggle açık ↔ koyu arasında geçiş yapar', () => {
    const service = freshService();
    service.set('light');
    expect(service.theme()).toBe('light');

    service.toggle();
    expect(service.theme()).toBe('dark');

    service.toggle();
    expect(service.theme()).toBe('light');
  });

  it('tema <html data-theme> attribute’una yazılır', () => {
    const service = freshService();

    service.set('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    service.set('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('tema tercihi localStorage’a kaydedilir', () => {
    const service = freshService();
    service.set('dark');
    expect(localStorage.getItem('game2048.theme')).toBe('dark');
  });

  it('kayıtlı tercih yeni serviste geri yüklenir (kalıcılık)', () => {
    localStorage.setItem('game2048.theme', 'dark');

    const service = freshService();

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
