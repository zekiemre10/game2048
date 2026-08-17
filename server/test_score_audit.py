"""score_audit — saf skor tutarlılık denetimi birim testi (DB'siz, ağsız).

Doğrular:
  1. min_score_for_tile / min_moves_for_tile bilinen 2048 matematiğini verir.
  2. Skor, en büyük kare için asgarinin altındaysa 'impossible' işareti.
  3. Hamle, kare için asgarinin altındaysa 'impossible' işareti.
  4. Aşırı skor/hamle oranı 'suspect'.
  5. Alandaki 2.'yi katbekat aşan skor 'suspect' (outlier).
  6. Önceki en iyiye göre ani sıçrama 'suspect'.
  7. Temiz (gerçekçi) kayıt hiç işaret almaz.
  8. worst_severity ağırlık sırasını doğru verir.

Çalıştır:  python server/test_score_audit.py
"""
import sys

import score_audit as sa

fails = []


def check(cond, label):
    mark = "✓" if cond else "✗"
    print(f"  {mark} {label}")
    if not cond:
        fails.append(label)


def main():
    # 1. Bilinen matematik
    check(sa.min_score_for_tile(2048) == 20480, "2048 için asgari skor 20480 (=10·2048)")
    check(sa.min_score_for_tile(4) == 4, "4 için asgari skor 4")
    check(sa.min_score_for_tile(2) == 0, "2 için asgari skor 0")
    check(sa.min_score_for_tile(48) == 0, "pow2 olmayan (48) → 0 (güvenli)")
    check(sa.min_moves_for_tile(2048) == 1023, "2048 için asgari hamle 1023 (=2^10−1)")
    check(sa.min_moves_for_tile(4) == 1, "4 için asgari hamle 1")

    # 2. Skor, kare için asgarinin altında → impossible
    f = sa.analyze_record(score=100, best_tile=2048)
    check(any(x["code"] == "score_below_tile_min" for x in f), "düşük skor+2048 karesi impossible işareti")
    check(sa.worst_severity(f) == sa.IMPOSSIBLE, "seviye impossible")

    # 3. Hamle, kare için asgarinin altında → impossible
    f = sa.analyze_record(score=30000, best_tile=2048, moves=50)
    check(any(x["code"] == "moves_below_tile_min" for x in f), "50 hamlede 2048 karesi impossible")

    # 4. Aşırı skor/hamle oranı → suspect
    f = sa.analyze_record(score=200000, best_tile=256, moves=100)
    # 256 (2^8) asgari skor 7·256=1792 (sağlanır), asgari hamle 127 → moves 100<127 impossible de olur;
    # burada oranı izole etmek için karesiz büyük hamle:
    f2 = sa.analyze_record(score=200000, best_tile=0, moves=100)
    check(any(x["code"] == "high_score_per_move" for x in f2), "skor/hamle 2000 > cap → suspect")

    # 5. Outlier: alandaki 2. çok düşük
    f = sa.analyze_record(score=500000, best_tile=0, field_second=1000)
    check(any(x["code"] == "field_outlier" for x in f), "alandaki 2.'nin 8x üstü → outlier")
    # sınırın altında outlier yok
    f = sa.analyze_record(score=60000, best_tile=0, field_second=20000)
    check(not any(x["code"] == "field_outlier" for x in f), "3x fark outlier değil")

    # 6. Ani sıçrama
    f = sa.analyze_record(score=300000, best_tile=0, prev_best=10000)
    check(any(x["code"] == "sudden_jump" for x in f), "önceki en iyinin 30x üstü → sıçrama")

    # 7. Temiz kayıt: 2048 karesi, gerçekçi skor+hamle, alan makul
    f = sa.analyze_record(score=32000, best_tile=2048, moves=1200, field_second=28000, prev_best=25000)
    check(f == [], f"gerçekçi 2048 oyunu temiz (işaret yok) — bulundu: {f}")

    # 8. worst_severity sırası
    check(sa.worst_severity([]) == "", "işaret yoksa seviye boş")
    check(
        sa.worst_severity([{"severity": "suspect"}, {"severity": "impossible"}]) == sa.IMPOSSIBLE,
        "impossible, suspect'ten ağır",
    )

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — skor denetim modülü")


if __name__ == "__main__":
    main()
