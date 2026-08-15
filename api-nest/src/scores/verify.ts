import { replayGame } from '../replay/replay';
import { MAX_MOVES, VALID_SIZES } from '../common/constants';

/**
 * app.py verify_transcript birebir. Gönderilen tohum+hamleleri doğrular ve
 * SUNUCUNUN hesapladığı skoru döndürür. İstemcinin skoru kullanılmaz.
 * Dönen: {ok, score, best, info}. ok=false → info hata sebebi.
 */
export function verifyTranscript(b: {
  seed?: unknown;
  moves?: unknown;
  size?: unknown;
}): { ok: boolean; score: number; best: number; info: string } {
  const seed = (Number(b?.seed) || 0) >>> 0;
  const moves = b?.moves;
  const size = Number(b?.size) || 4;

  if (typeof moves !== 'string') return { ok: false, score: 0, best: 0, info: 'missing_transcript' };
  if (!VALID_SIZES.includes(size as any)) return { ok: false, score: 0, best: 0, info: 'bad_size' };
  if (moves.length > MAX_MOVES) return { ok: false, score: 0, best: 0, info: 'too_long' };

  const result = replayGame(seed, moves, size);
  if (!result.valid) return { ok: false, score: 0, best: 0, info: 'invalid_replay' };

  return { ok: true, score: result.score, best: result.maxTile, info: 'ok' };
}
