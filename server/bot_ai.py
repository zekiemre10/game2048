"""
2048 — Sunucu tarafı BOT motoru (expectimax).

İstemcideki src/app/logic/ai.ts içindeki bot fonksiyonlarının (botMove /
playBotGame) BİREBİR Python eşi. Çok oyunculu yarışta bot artık SUNUCUDA koşar:
tohumdan botun tüm oyununu bir kez oynatıp skor ZAMAN ÇİZELGESİ üretiriz; yarış
boyunca o çizelge yayınlanır (gerçek zamanlı hesap yok, host'tan/ cihazdan
bağımsız, manipüle edilemez).

DETERMİNİZM & PARİTE:
  - Sabit derinlik (zaman sınırı yok) → makineden bağımsız.
  - Ağırlıklar TAM SAYIYA yuvarlanır → tek transandantal (pow) işlemi sabitlenir;
    geri kalan her şey tam-sayı/IEEE aritmetiğidir → JS ile birebir aynı sonuç.
  Parite server/test_bot_parity.py (TS'in ürettiği bot_fixtures.json) ile korunur.
"""
import math

from replay import mulberry32, move_grid, _empty_cells, _spawn, _max, _MASK

CHANCE_OF_FOUR = 0.1
NO_MOVE_PENALTY = -1e15
DIRECTIONS = ("up", "down", "left", "right")
DIR_CHAR = {"up": "U", "down": "D", "left": "L", "right": "R"}

# Botun hamle temposu (ms) — güçlü seviye daha hızlı/akıcı oynar. Sunucu skor
# çizelgesini bu tempoya göre yayınlar (eski istemci speedFor'un sunucu karşılığı).
BOT_SPEED_MS = {"easy": 480, "medium": 360, "hard": 280, "expert": 240}

# Seviye başına arama ayarları — ai.ts LEVEL_CFG + BOT_DEPTH ile BİREBİR aynı.
BOT_CFG = {
    "easy":   {"depth": 1, "sampleK": 2, "expandFour": True,  "snakePow": 1.0, "emptyMul": 4},
    "medium": {"depth": 2, "sampleK": 1, "expandFour": False, "snakePow": 0.3, "emptyMul": 1},
    "hard":   {"depth": 2, "sampleK": 2, "expandFour": True,  "snakePow": 1.0, "emptyMul": 4},
    "expert": {"depth": 3, "sampleK": 2, "expandFour": True,  "snakePow": 1.0, "emptyMul": 4},
}

_weight_cache = {}


def snake_weights(n, pow):
    """ai.ts snakeWeights ile birebir: yılan gradyanı, floor(base^(idx·pow)+0.5)."""
    key = (n, pow)
    cached = _weight_cache.get(key)
    if cached is not None:
        return cached
    base = 3 if n >= 5 else 4
    w = [[0] * n for _ in range(n)]
    idx = n * n - 1
    for r in range(n):
        cols = range(n) if r % 2 == 0 else range(n - 1, -1, -1)
        for c in cols:
            w[r][c] = int(math.floor(math.pow(base, idx * pow) + 0.5))
            idx -= 1
    _weight_cache[key] = w
    return w


def evaluate(g, snake_pow, empty_mul):
    """Izgarayı puanlar — ai.ts evaluate ile birebir (tam-sayı)."""
    n = len(g)
    w = snake_weights(n, snake_pow)
    weighted = 0
    empties = 0
    max_val = 0
    for r in range(n):
        for c in range(n):
            v = g[r][c]
            if v == 0:
                empties += 1
                continue
            weighted += v * w[r][c]
            if v > max_val:
                max_val = v
    return weighted + empties * max_val * empty_mul


def _sample_cells(cells, k):
    """ai.ts sampleCells ile birebir: eşit aralıklı k hücre (deterministik)."""
    step = len(cells) / k
    out = []
    for i in range(k):
        out.append(cells[int(math.floor(i * step))])
    return out


def _place(g, r, c, v):
    out = [row[:] for row in g]
    out[r][c] = v
    return out


def _max_node(g, depth, cfg):
    if depth == 0:
        return evaluate(g, cfg["snakePow"], cfg["emptyMul"])
    best = None
    for d in DIRECTIONS:
        nxt, _gained, moved = move_grid(g, d)
        if not moved:
            continue
        v = _chance_node(nxt, depth - 1, cfg)
        if best is None or v > best:
            best = v
    return NO_MOVE_PENALTY if best is None else best


def _chance_node(g, depth, cfg):
    if depth == 0:
        return evaluate(g, cfg["snakePow"], cfg["emptyMul"])
    cells = _empty_cells(g)
    if not cells:
        return evaluate(g, cfg["snakePow"], cfg["emptyMul"])
    k = cfg["sampleK"]
    sample = _sample_cells(cells, k) if len(cells) > k else cells
    total = 0.0
    per = 1 / len(sample)
    for (r, c) in sample:
        if cfg["expandFour"]:
            total += per * 0.9 * _max_node(_place(g, r, c, 2), depth, cfg)
            total += per * CHANCE_OF_FOUR * _max_node(_place(g, r, c, 4), depth, cfg)
        else:
            total += per * _max_node(_place(g, r, c, 2), depth, cfg)
    return total


def bot_move(g, level):
    """Sabit derinlikte deterministik expectimax hamlesi. ai.ts botMove eşi."""
    cfg = BOT_CFG[level]
    legal = [d for d in DIRECTIONS if move_grid(g, d)[2]]
    if not legal:
        return None
    if len(legal) == 1:
        return legal[0]
    best = legal[0]
    best_val = None
    for d in legal:
        nxt, _gained, _moved = move_grid(g, d)
        v = _chance_node(nxt, cfg["depth"] - 1, cfg)
        if best_val is None or v > best_val:
            best_val = v
            best = d
    return best


def play_bot_game(seed, level, max_moves, size=4, on_progress=None, progress_every=32):
    """
    Tohumdan botun oyununu (en çok max_moves hamle) oynatır; skor ZAMAN
    çizelgesini döndürür. ai.ts playBotGame ile birebir.
      scores[k] = k. hamleden SONRA kümülatif skor (scores[0] = 0)
      bests[k]  = k. hamleden sonra en büyük kare

    on_progress(scores, bests) verilirse her `progress_every` hamlede bir (ve
    oyun bitince) çağrılır → sunucu çizelgeyi ARTIMLI yayınlar (uzun süren Uzman
    hesabında bot yarış saatini geçtiği için hiç aç kalmaz). Callback OYUNU
    ETKİLEMEZ; çıktı parite testinde birebir aynıdır.
    """
    rand = mulberry32(seed & _MASK)
    grid = [[0] * size for _ in range(size)]
    _spawn(grid, rand)
    _spawn(grid, rand)

    moves = []
    scores = [0]
    bests = [_max(grid)]
    score = 0
    for i in range(max_moves):
        d = bot_move(grid, level)
        if d is None:
            break
        nxt, gained, moved = move_grid(grid, d)
        if not moved:
            break
        grid = nxt
        score += gained
        moves.append(DIR_CHAR[d])
        _spawn(grid, rand)
        scores.append(score)
        bests.append(_max(grid))
        if on_progress is not None and (i + 1) % progress_every == 0:
            on_progress(scores, bests)

    if on_progress is not None:
        on_progress(scores, bests)
    return {
        "moves": "".join(moves),
        "scores": scores,
        "bests": bests,
        "maxTile": _max(grid),
        "finalScore": score,
    }
