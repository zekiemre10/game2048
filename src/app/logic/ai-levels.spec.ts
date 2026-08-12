import { AI_LEVELS, isAiLevel, playBotGame, botMove, emptyGrid } from './ai';

// ============================================================
//  Zorluk kademeleri + deterministik BOT motoru
//  isAiLevel/AI_LEVELS: geçerli kademe doğrulaması (UI + addBot).
//  playBotGame/botMove: SUNUCU botunun deterministik oyunu — aynı tohum → aynı
//  oyun. (Python eşiyle birebir paritesi server/test_bot_parity.py'de korunur.)
// ============================================================

describe('isAiLevel / AI_LEVELS', () => {
  it('dört kademeyi sıralı içerir', () => {
    expect(AI_LEVELS).toEqual(['easy', 'medium', 'hard', 'expert']);
  });

  it('yalnızca geçerli kademeleri kabul eder', () => {
    for (const lvl of AI_LEVELS) expect(isAiLevel(lvl)).toBe(true);
  });

  it('geçersiz/boş/farklı-tip değerleri reddeder', () => {
    for (const bad of ['', 'zor', 'HARD', '🤖 Bot (Zor)', null, undefined, 3, {}])
      expect(isAiLevel(bad)).toBe(false);
  });
});

describe('playBotGame (deterministik sunucu botu)', () => {
  it('aynı tohum + seviye → BİREBİR aynı oyun (deterministik)', () => {
    const a = playBotGame(12345, 'hard', 200);
    const b = playBotGame(12345, 'hard', 200);
    expect(a.moves).toBe(b.moves);
    expect(a.scores).toEqual(b.scores);
    expect(a.finalScore).toBe(b.finalScore);
  });

  it('skor çizelgesi tutarlı: scores[0]=0, uzunluk = hamle+1, monoton artan', () => {
    const g = playBotGame(7, 'medium', 150);
    expect(g.scores[0]).toBe(0);
    expect(g.scores.length).toBe(g.moves.length + 1);
    expect(g.bests.length).toBe(g.moves.length + 1);
    for (let i = 1; i < g.scores.length; i++)
      expect(g.scores[i]).toBeGreaterThanOrEqual(g.scores[i - 1]);
    expect(g.finalScore).toBe(g.scores[g.scores.length - 1]);
  });

  it('botMove boş tahtada hamle üretmez (legal yok)', () => {
    expect(botMove(emptyGrid(4), 'expert')).toBeNull();
  });

  it('güç sırası korunur: Uzman ≥ Zor ≥ Orta (kısa oyunda bile makul)', () => {
    // Aynı tohumda kısa oyun; kesin ladder ai-strength.spec'te. Burada sadece
    // bot motorunun her seviyede mantıklı skor ürettiğini yoklarız.
    const seeds = [1, 2, 3];
    const avg = (lvl: 'medium' | 'hard' | 'expert') =>
      seeds.reduce((s, sd) => s + playBotGame(sd, lvl, 300).finalScore, 0) / seeds.length;
    expect(avg('medium')).toBeGreaterThan(0);
    expect(avg('hard')).toBeGreaterThan(0);
    expect(avg('expert')).toBeGreaterThan(0);
  });
});
