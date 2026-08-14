import {
  BOT_CHARACTERS,
  BOT_CHARACTER_IDS,
  BOT_CHARACTER_STRENGTH,
  isBotCharacter,
  playBotGameByKey,
  resolveBotConfig,
} from './ai';

describe('Bot karakterleri — kayıt defteri + parite-güvenli ayarlar', () => {
  it('en az 4 karakter, hepsinin avatarı + ölçülen gücü var', () => {
    expect(BOT_CHARACTER_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of BOT_CHARACTER_IDS) {
      expect(BOT_CHARACTERS[id].avatar.length).toBeGreaterThan(0);
      const s = BOT_CHARACTER_STRENGTH[id];
      expect(s.reach2048).toBeGreaterThanOrEqual(0);
      expect(s.reach2048).toBeLessThanOrEqual(100);
      expect(s.avg).toBeGreaterThan(0);
    }
  });

  it('isBotCharacter yalnızca geçerli kimlikleri kabul eder', () => {
    expect(isBotCharacter('corner')).toBe(true);
    expect(isBotCharacter('balanced')).toBe(true);
    expect(isBotCharacter('easy')).toBe(false); // zorluk kademesi, karakter değil
    expect(isBotCharacter('godmode')).toBe(false);
    expect(isBotCharacter(undefined)).toBe(false);
  });

  it('resolveBotConfig karakteri karakter ayarına, kademeyi kademe ayarına çözer', () => {
    expect(resolveBotConfig('corner')).toEqual(BOT_CHARACTERS.corner.cfg);
    // Bilinmeyen anahtar → güvenli varsayılan (çökme yok).
    expect(resolveBotConfig('nonsense').depth).toBeGreaterThan(0);
  });
});

describe('Bot karakterleri — aynı tohumda GÖZLE GÖRÜLÜR farklı oynar', () => {
  const SEED = 12345;
  const MOVES = 150;

  it('her karakter aynı tohumda farklı bir hamle dizisi üretir', () => {
    const games = BOT_CHARACTER_IDS.map((id) => ({
      id,
      moves: playBotGameByKey(SEED, id, MOVES).moves,
    }));
    // Tüm diziler benzersiz olmalı (hiç iki karakter birebir aynı oynamamalı).
    const unique = new Set(games.map((g) => g.moves));
    expect(unique.size).toBe(BOT_CHARACTER_IDS.length);
  });

  it('Köşeci ile Acelesi Var belirgin biçimde ayrışır (ilk 40 hamlede)', () => {
    const corner = playBotGameByKey(SEED, 'corner', 60).moves.slice(0, 40);
    const hasty = playBotGameByKey(SEED, 'hasty', 60).moves.slice(0, 40);
    expect(corner).not.toBe(hasty);
  });

  it('aynı karakter + aynı tohum DETERMİNİSTİK (hep aynı oyun)', () => {
    const a = playBotGameByKey(SEED, 'balanced', MOVES);
    const b = playBotGameByKey(SEED, 'balanced', MOVES);
    expect(a.moves).toBe(b.moves);
    expect(a.finalScore).toBe(b.finalScore);
  });
});
