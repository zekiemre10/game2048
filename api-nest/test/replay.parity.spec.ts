import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayGame } from '../src/replay/replay';

// ============================================================
//  Replay motoru paritesi (KABUL KRİTERİ: 150 fixture geçmeli).
//  server/replay_fixtures.json istemci mantığıyla üretildi; NestJS replay
//  HER transkript için AYNI skor + maxTile vermeli (Python/istemci ile birebir).
// ============================================================

interface Fixture {
  seed: number;
  size: number;
  moves: string;
  score: number;
  maxTile: number;
}

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'server', 'replay_fixtures.json'), 'utf-8'),
);

describe('replay parity (150 fixture)', () => {
  it('150 fixture yüklendi', () => {
    expect(FIXTURES.length).toBe(150);
  });

  it.each(FIXTURES.map((fx, i) => [i, fx] as const))(
    'fixture[%i] skor+maxTile birebir eşleşir',
    (_i, fx) => {
      const r = replayGame(fx.seed, fx.moves, fx.size);
      expect(r.valid).toBe(true);
      expect(r.score).toBe(fx.score);
      expect(r.maxTile).toBe(fx.maxTile);
    },
  );
});
