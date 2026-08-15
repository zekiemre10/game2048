import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playBotGame } from '../src/rooms/bot-ai';

// ============================================================
//  Bot motoru paritesi — NestJS botu (expectimax) istemci ai.ts / Python
//  bot_ai.py ile BİREBİR. server/bot_fixtures.json (TS üretti) her tohum+key
//  için aynı hamle dizisi + skor çizelgesi + maxTile vermeli.
// ============================================================

interface BotFixture {
  seed: number;
  key?: string;
  level?: string;
  maxMoves: number;
  moves: string;
  scores: number[];
  bests: number[];
  maxTile: number;
  finalScore: number;
}

const DATA = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'server', 'bot_fixtures.json'), 'utf-8'),
);
const FIXTURES: BotFixture[] = DATA.fixtures;

describe('bot parity (bot_fixtures.json)', () => {
  it('fixture yüklendi', () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
  });

  it.each(FIXTURES.map((fx, i) => [i, fx] as const))(
    'fixture[%i] hamle+skor+maxTile birebir',
    (_i, fx) => {
      const key = (fx.key ?? fx.level) as string;
      const got = playBotGame(fx.seed, key, fx.maxMoves);
      expect(got.moves).toBe(fx.moves);
      expect(got.scores).toEqual(fx.scores);
      expect(got.bests).toEqual(fx.bests);
      expect(got.maxTile).toBe(fx.maxTile);
      expect(got.finalScore).toBe(fx.finalScore);
    },
  );
});
