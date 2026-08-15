// ============================================================
//  Sabitler — Python app.py ile BİREBİR. Değerler davranış-yüklüdür
//  (limitler, PBKDF2 tur sayıları, ödül, tie-break); değiştirmeden taşındı.
// ============================================================

export const USERNAME_RE = /^[A-Za-z0-9_.\-çğışöüÇĞİŞÖÜ ]{2,20}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const PBKDF2_ITERS = 600_000; // OWASP 2024 (PBKDF2-SHA256)
export const LEGACY_ITERS = 120_000; // eski hesaplar (girişte yükseltilir)
export const TOKEN_TTL = 60 * 60 * 24 * 90; // 90 gün (saniye)

export const MAX_BODY = 256 * 1024; // istek gövdesi üst sınırı
export const MAX_DATA = 64 * 1024; // /sync ile saklanabilecek en büyük kayıt
export const MAX_SCORE = 10_000_000;
export const MAX_MOVES = 100_000;
export const VALID_SIZES = [3, 4, 5] as const;

export const SUBMIT_MAX = 20;
export const SUBMIT_WINDOW = 60;
export const LOGIN_MAX_TRIES = 10;
export const LOGIN_WINDOW = 120;

// CORS — yalnız oyunun yayınlandığı köken(ler). Ortamdan okunur; canlı +
// yerel geliştirme varsayılanı. Airport tarafındaki gibi asla "*" değil.
export const DEFAULT_CORS_ORIGINS =
  'http://34.158.136.9,http://localhost:4200,http://127.0.0.1:4200';

// Ay sonu şampiyonluk ödülü (bilinçli olarak büyük).
export const CHAMPION_PRIZE = {
  gold: 2000,
  powers: { time: 3, bomb: 3, shuffle: 3, undo: 3, hint: 3 },
};

// Oda kodu alfabesi — 0/O/1/I yok (karıştırılabilir).
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_BOTS_PER_ROOM = 5;
export const ROOM_STALE_SECONDS = 6 * 3600;

// --- İçerik filtresi (kullanıcı adı + sohbet) ---------------------------
const BANNED_EXACT = new Set(['amk', 'aq', 'sik', 'pic', 'ibne', 'pust', 'yavsak']);
const BANNED_SUB = [
  'orospu', 'siktir', 'sikeyim', 'sikik', 'pezevenk', 'gavat', 'kahpe',
  'amcik', 'yarrak', 'yarak', 'gotveren', 'oglunu',
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'nigger',
  'faggot', 'whore', 'motherfuck',
];

const TR_MAP: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', î: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a',
};
const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's',
};

function normalizeText(s: string): string {
  let out = '';
  for (const ch of String(s).toLowerCase()) {
    out += TR_MAP[ch] ?? LEET_MAP[ch] ?? ch;
  }
  return out.replace(/[^a-z0-9]+/g, ' ');
}

/** Metin yasaklı kelime içeriyor mu (app.py contains_banned ile birebir). */
export function containsBanned(text: unknown): boolean {
  if (!text) return false;
  const norm = normalizeText(text as string);
  const tokens = norm.split(' ').filter(Boolean);
  if (tokens.some((t) => BANNED_EXACT.has(t))) return true;
  const joined = tokens.join('');
  return BANNED_SUB.some((w) => joined.includes(w));
}
