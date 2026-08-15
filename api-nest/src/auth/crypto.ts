import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { PBKDF2_ITERS, LEGACY_ITERS } from '../common/constants';

// ============================================================
//  Parola hash — app.py hash_pw/check_pw ile BİREBİR.
//  PBKDF2-HMAC-SHA256, keylen=32 (sha256 digest), salt = 16 baytın hex'i,
//  ve DİKKAT: salt hash'e UTF-8 STRING olarak verilir (hex çözülmez).
//  Eski 120k turlu hesaplar girişte 600k'ya sessizce yükseltilir.
// ============================================================

export function hashPw(password: string, salt: string, iters: number = PBKDF2_ITERS): string {
  return pbkdf2Sync(
    Buffer.from(password, 'utf-8'),
    Buffer.from(salt, 'utf-8'), // app.py salt.encode("utf-8") — hex string'in baytları
    iters,
    32,
    'sha256',
  ).toString('hex');
}

/** Sabit zamanlı hex karşılaştırma. */
function eq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 16 bayt → 32 hex (secrets.token_hex(16)). */
export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** 32 bayt → 64 hex Bearer token (secrets.token_hex(32)). */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Parola doğrulama. 600k eşleşirse true; değilse 120k (legacy) dener —
 * eşleşirse `upgraded` döner (çağıran pwhash'i 600k'ya yeniler). Aksi false.
 */
export function verifyPw(
  pwhash: string,
  salt: string,
  password: string,
): { ok: boolean; upgraded?: string } {
  if (eq(pwhash, hashPw(password, salt))) return { ok: true };
  if (eq(pwhash, hashPw(password, salt, LEGACY_ITERS))) {
    return { ok: true, upgraded: hashPw(password, salt) };
  }
  return { ok: false };
}
