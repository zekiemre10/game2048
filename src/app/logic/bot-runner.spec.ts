import { resolveBotLevel } from './bot-runner';
import { AI_LEVELS, isAiLevel } from './ai';

// ============================================================
//  BOT SEVİYESİ — VERİDEN çözülür, isimden DEĞİL (regresyon)
//  Eski levelFromName() botun görünen adında string arardı; ad çevrilince
//  ya da biçimi değişince seviye sessizce medium'a düşerdi. Bu testler
//  seviyenin veri olarak taşındığını ve isim metnine hiç bakılmadığını korur.
// ============================================================

describe('isAiLevel', () => {
  it('yalnızca geçerli kademeleri kabul eder', () => {
    for (const lvl of AI_LEVELS) expect(isAiLevel(lvl)).toBe(true);
  });

  it('geçersiz/boş/farklı-tip değerleri reddeder', () => {
    for (const bad of ['', 'hafif', 'HARD', 'kolay', '🤖 Bot (Zor)', null, undefined, 3, {}])
      expect(isAiLevel(bad)).toBe(false);
  });
});

describe('resolveBotLevel (veriden çözer, isimden değil)', () => {
  it('sunucunun taşıdığı geçerli seviyeyi olduğu gibi kullanır', () => {
    expect(resolveBotLevel('easy')).toBe('easy');
    expect(resolveBotLevel('medium')).toBe('medium');
    expect(resolveBotLevel('hard')).toBe('hard');
    expect(resolveBotLevel('expert')).toBe('expert');
  });

  it('seviye verisi yoksa host’un kaydettiği seviyeye (köprü) düşer', () => {
    expect(resolveBotLevel(undefined, 'expert')).toBe('expert');
    expect(resolveBotLevel(null, 'hard')).toBe('hard');
  });

  it('sunucu verisi geçerliyse köprüyü değil onu tercih eder', () => {
    expect(resolveBotLevel('hard', 'easy')).toBe('hard');
  });

  it('hiçbir veri yoksa güvenli varsayılan medium’dur (geriye dönük uyum)', () => {
    expect(resolveBotLevel(undefined, undefined)).toBe('medium');
    expect(resolveBotLevel(null)).toBe('medium');
  });

  it('görünen bot ADINI seviye olarak ÇÖZMEZ (asıl regresyon)', () => {
    // Ad ne olursa olsun (çeviri, emoji, biçim) seviyeye dönüşmez → medium.
    expect(resolveBotLevel('🤖 Bot (Uzman)')).toBe('medium');
    expect(resolveBotLevel('🤖 Bot (Expert)')).toBe('medium');
    expect(resolveBotLevel('Zor')).toBe('medium');
    // Köprü verisi geçerliyse ad yine hiç dikkate alınmaz.
    expect(resolveBotLevel('🤖 Bot (Kolay)', 'expert')).toBe('expert');
  });
});
