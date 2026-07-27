"""
2048 — Sunucu tarafı oyun tekrarı (replay) DOĞRULAMA motoru.

İstemcideki src/app/logic/replay.ts dosyasının BİREBİR Python eşi.
Tohum + hamle dizisinden oyunu yeniden oynatıp skoru KENDİMİZ hesaplarız;
istemcinin iddia ettiği skor kullanılmaz → skor tablosu hile yapılamaz.

Determinizm için mulberry32, JS'in 32-bit tam sayı semantiğiyle
(Math.imul, >>>, |0) birebir taşınmıştır. Parite test/replay_parity ile
istemci transkriptlerine karşı doğrulanır.
"""

CHANCE_OF_FOUR = 0.1
_MASK = 0xFFFFFFFF

CHAR_MOVE = {"U": "up", "D": "down", "L": "left", "R": "right"}


def _imul(a, b):
    """JS Math.imul: 32-bit'e kırpılmış çarpım (bit deseni)."""
    return (a * b) & _MASK


def mulberry32(seed):
    """JS mulberry32 ile birebir aynı sözde-rastgele üretici (0..1)."""
    a = seed & _MASK

    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & _MASK
        t = _imul(a ^ (a >> 15), (1 | a) & _MASK)
        t = (((t + _imul(t ^ (t >> 7), (61 | t) & _MASK)) & _MASK) ^ t) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296.0

    return rng


def _empty_cells(grid):
    """Boş hücreler — satır öncelikli (istemci ile aynı sıra)."""
    n = len(grid)
    out = []
    for r in range(n):
        for c in range(n):
            if grid[r][c] == 0:
                out.append((r, c))
    return out


def _spawn(grid, rand):
    """Bir taş üretir (iki rand() çekimi). Boş yoksa hiçbir şey yapmaz."""
    import math

    cells = _empty_cells(grid)
    if not cells:
        return
    r, c = cells[int(math.floor(rand() * len(cells)))]
    grid[r][c] = 4 if rand() < CHANCE_OF_FOUR else 2


def move_grid(grid, direction):
    """Bir yönde kaydırıp birleştirir. Dönen: (yeni_grid, kazanç, degisti)."""
    n = len(grid)
    horizontal = direction in ("left", "right")
    toward_start = direction in ("left", "up")
    nxt = [[0] * n for _ in range(n)]
    gained = 0

    for line in range(n):
        vals = []
        for i in range(n):
            idx = i if toward_start else n - 1 - i
            v = grid[line][idx] if horizontal else grid[idx][line]
            if v != 0:
                vals.append(v)

        merged = []
        merged_flag = False
        for v in vals:
            if merged and not merged_flag and merged[-1] == v:
                merged[-1] *= 2
                gained += merged[-1]
                merged_flag = True
            else:
                merged.append(v)
                merged_flag = False

        for i, mv in enumerate(merged):
            idx = i if toward_start else n - 1 - i
            if horizontal:
                nxt[line][idx] = mv
            else:
                nxt[idx][line] = mv

    moved = any(grid[r][c] != nxt[r][c] for r in range(n) for c in range(n))
    return nxt, gained, moved


def replay_game(seed, moves, size):
    """
    Tohum + hamle dizisini yeniden oynatır.
    Dönen: {"score", "maxTile", "moves", "valid"}.
    Geçersiz karakter veya tahtayı değiştirmeyen hamle → valid=False.
    """
    rand = mulberry32(seed & _MASK)
    grid = [[0] * size for _ in range(size)]

    _spawn(grid, rand)
    _spawn(grid, rand)

    score = 0
    count = 0
    for ch in moves:
        direction = CHAR_MOVE.get(ch)
        if direction is None:
            return _invalid(grid, score, count)
        nxt, gained, moved = move_grid(grid, direction)
        if not moved:
            return _invalid(grid, score, count)
        grid = nxt
        score += gained
        count += 1
        _spawn(grid, rand)

    return {"score": score, "maxTile": _max(grid), "moves": count, "valid": True}


def _invalid(grid, score, moves):
    return {"score": score, "maxTile": _max(grid), "moves": moves, "valid": False}


def _max(grid):
    m = 0
    for row in grid:
        for v in row:
            if v > m:
                m = v
    return m


def daily_seed(day):
    """Gün anahtarından (YYYY-MM-DD) tohum — istemci dailySeed() ile birebir.

    FNV-1a 32-bit. Günlük meydan okumada herkes AYNI tahtayı oynar; sunucu
    tohumu kendisi hesaplar, oyuncu kolay bir tohum seçemez.
    """
    h = 2166136261
    for ch in day:
        h ^= ord(ch)
        h = (h * 16777619) & _MASK
    return h or 1
