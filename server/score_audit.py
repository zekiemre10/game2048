"""Skor tutarlılık denetimi — şüpheli/imkânsız leaderboard kayıtlarını işaretler.

Saf fonksiyonlar (DB'siz, yan etkisiz) → kolay test edilir ve açıklanabilir.
`app.py` bunu import eder; DEPLOY'da app.py ile BİRLİKTE gönderilmeli (yoksa
servis ModuleNotFoundError ile çöker — bkz. game2048-backend-deploy notu).

2048 puanlama gerçeği: skor, birleşen karenin değeri kadar artar. Bu iki
MATEMATİKSEL alt sınırı verir (ihlali = imkânsız, yüksek güven):

- Bir 2^k karesi oluşturmak için gereken ASGARİ toplam skor: (k-1)·2^k.
  (2048 = 2^11 için 10·2048 = 20480.)
- Bir 2^k karesi için gereken ASGARİ hamle: en az 2^(k-1) taban karesi (değer 2)
  spawn olmalı; her hamle ~1 spawn üretir → hamle ≥ 2^(k-1) − 1.

Ek olarak istatistiksel işaretler (kesin değil, İNCELEME gerektirir):
skor/hamle oranı aşırı, alandaki ikinciyi katbekat aşan skor (outlier),
oyuncunun önceki en iyisine göre ani sıçrama.

NOT (bilinen sınır): oyun SÜRESİ hiçbir skor tablosunda saklanmıyor
(monthly_scores/daily_scores süre tutmaz). "İmkânsız kısa süre" doğrudan
ölçülemez; skor/hamle oranı + asgari-hamle kontrolü bunun yerine geçen vekildir.
"""

# İşaret ağırlıkları
IMPOSSIBLE = "impossible"  # matematiksel olarak olanaksız → güçlü kanıt
SUSPECT = "suspect"        # aykırı → elle inceleme gerekir

# Ayarlanabilir eşikler (elle müdahale her zaman mümkün — bunlar sadece işaret)
RATIO_CAP = 1200           # sürdürülen skor/hamle bunun üstündeyse şüpheli
OUTLIER_FACTOR = 8         # alandaki 2.'yi bu kat aşarsa outlier
OUTLIER_MIN = 50_000       # ...ama yalnız skor bu tabanın üstündeyse
JUMP_FACTOR = 10           # oyuncunun önceki en iyisini bu kat aşarsa sıçrama


def _is_pow2(n: int) -> bool:
    return isinstance(n, int) and n >= 2 and (n & (n - 1)) == 0


def _tile_exp(tile: int) -> int:
    """2^k → k (tile pow2 varsayılır)."""
    return tile.bit_length() - 1


def min_score_for_tile(tile: int) -> int:
    """Bir 2^k karesine ULAŞMAK için gereken asgari toplam skor: (k-1)·2^k.

    tile < 4 (yani 2 ya da geçersiz) için 0 (2 karesi skor gerektirmez).
    """
    if not _is_pow2(tile) or tile < 4:
        return 0
    k = _tile_exp(tile)
    return (k - 1) * tile


def min_moves_for_tile(tile: int) -> int:
    """Bir 2^k karesi için gereken asgari hamle (kaba alt sınır): 2^(k-1) − 1."""
    if not _is_pow2(tile) or tile < 4:
        return 0
    k = _tile_exp(tile)
    return (1 << (k - 1)) - 1


def analyze_record(
    score,
    best_tile,
    moves=None,
    field_second=None,
    prev_best=None,
    ratio_cap: int = RATIO_CAP,
    outlier_factor: int = OUTLIER_FACTOR,
    outlier_min: int = OUTLIER_MIN,
    jump_factor: int = JUMP_FACTOR,
):
    """Tek bir skor kaydını değerlendirir → işaret listesi (boşsa temiz).

    Parametreler:
      score        : iddia edilen skor
      best_tile    : o oyundaki en büyük kare (2^k)
      moves        : hamle sayısı (biliniyorsa; monthly'de yok, daily'de var)
      field_second : aynı tablodaki 2. en yüksek skor (outlier için; yoksa None)
      prev_best    : oyuncunun önceki en iyisi (ani sıçrama için; yoksa None)

    Dönen her işaret: {code, severity, detail}.
    """
    flags = []
    st = int(score or 0)
    bt = int(best_tile or 0)

    if bt >= 4 and _is_pow2(bt):
        need = min_score_for_tile(bt)
        if st < need:
            flags.append({
                "code": "score_below_tile_min",
                "severity": IMPOSSIBLE,
                "detail": f"skor {st} < {bt} karesi için asgari {need}",
            })
        if moves is not None:
            need_mv = min_moves_for_tile(bt)
            if int(moves) < need_mv:
                flags.append({
                    "code": "moves_below_tile_min",
                    "severity": IMPOSSIBLE,
                    "detail": f"{int(moves)} hamle < {bt} için asgari {need_mv} hamle",
                })

    if moves is not None and int(moves) > 0:
        ratio = st / int(moves)
        if ratio > ratio_cap:
            flags.append({
                "code": "high_score_per_move",
                "severity": SUSPECT,
                "detail": f"skor/hamle {ratio:.0f} > {ratio_cap}",
            })

    if field_second is not None and int(field_second) >= 0:
        fs = int(field_second)
        if st >= outlier_min and st > outlier_factor * max(fs, 1):
            flags.append({
                "code": "field_outlier",
                "severity": SUSPECT,
                "detail": f"skor {st}, alandaki 2.'nin ({fs}) {outlier_factor}x üstünde",
            })

    if prev_best is not None and int(prev_best) > 0:
        pb = int(prev_best)
        if st > jump_factor * pb:
            flags.append({
                "code": "sudden_jump",
                "severity": SUSPECT,
                "detail": f"skor {st}, önceki en iyi {pb} değerinin {jump_factor}x üstünde",
            })

    return flags


def worst_severity(flags) -> str:
    """İşaret listesindeki en ağır seviye ('impossible' > 'suspect' > '')."""
    if any(f["severity"] == IMPOSSIBLE for f in flags):
        return IMPOSSIBLE
    if flags:
        return SUSPECT
    return ""
