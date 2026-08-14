import { TestBed } from '@angular/core/testing';
import { ProfileService } from './profile.service';
import { GameService } from './game.service';

describe('Uyarlanabilir eşleştirme — kayan pencere + boyut bazlı', () => {
  let profile: ProfileService;
  let game: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    profile = TestBed.inject(ProfileService);
    game = TestBed.inject(GameService);
  });

  it('kayan pencere en fazla 5 skor tutar (en eskiler düşer); ortalama doğru', () => {
    for (const s of [1000, 2000, 3000, 4000, 5000, 6000]) profile.recordRecentScore(4, s);
    // Son 5: 2000..6000 → ortalama 4000
    expect(profile.recentAvg(4)).toBe(4000);
  });

  it('boyut skoru çok etkilediği için pencere BOYUT bazında ayrı tutulur', () => {
    profile.recordRecentScore(3, 500);
    profile.recordRecentScore(4, 20000);
    profile.recordRecentScore(5, 90000);
    expect(profile.recentAvg(3)).toBe(500);
    expect(profile.recentAvg(4)).toBe(20000);
    expect(profile.recentAvg(5)).toBe(90000);
  });

  it('geçmiş yoksa ortalama 0 (yeni oyuncu)', () => {
    expect(profile.recentAvg(4)).toBe(0);
  });

  it('0/negatif skor pencereye eklenmez', () => {
    profile.recordRecentScore(4, 0);
    profile.recordRecentScore(4, -100);
    expect(profile.recentAvg(4)).toBe(0);
  });

  it('düşük 4×4 performansı → matchedRung zayıf rung seçer', () => {
    for (let i = 0; i < 5; i++) profile.recordRecentScore(4, 3000);
    expect(game.matchedRung(4)).toBe('hasty');
  });

  it('yüksek 4×4 performansı → matchedRung güçlü rung seçer', () => {
    for (let i = 0; i < 5; i++) profile.recordRecentScore(4, 45000);
    // Geçmiş yok → yumuşatma yok; hedef 45000×1.1 ≈ 49500 → 'corner' (41500) veya 'expert'
    expect(['corner', 'expert']).toContain(game.matchedRung(4));
  });

  it('lastAdaptiveKey kalıcı — yumuşatma bir sonraki eşleşmede kullanılır', () => {
    game.commitAdaptiveKey('space');
    expect(profile.lastAdaptiveKey()).toBe('space');
    // Önceki 'space' iken çok yüksek performans → en çok bir basamak yukarı ('balanced').
    for (let i = 0; i < 5; i++) profile.recordRecentScore(4, 60000);
    expect(game.matchedRung(4)).toBe('balanced');
  });
});
