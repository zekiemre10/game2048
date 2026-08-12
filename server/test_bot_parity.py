"""
Bot motoru PARİTESİ — Python == TypeScript (birebir).

server/bot_ai.py (sunucu botu) ile src/app/logic/ai.ts (istemci referansı) AYNI
tohumda BİREBİR aynı oyunu üretmeli: aynı hamle dizisi, aynı skor ZAMAN
çizelgesi, aynı en büyük kare. Fixture'ları TS üretir (scripts/gen-bot-fixtures.mjs
→ bot_fixtures.json); bu test Python botuyla yeniden oynatıp karşılaştırır.

Böylece botu sunucuya taşırken davranışın istemcideki iyi test edilmiş motorla
aynı kaldığı garanti altına alınır.

Çalıştır:  python server/test_bot_parity.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bot_ai import play_bot_game  # noqa: E402


def main():
    with open(os.path.join(HERE, "bot_fixtures.json"), encoding="utf-8") as f:
        data = json.load(f)
    fixtures = data["fixtures"]

    fails = 0
    for fx in fixtures:
        got = play_bot_game(fx["seed"], fx["level"], fx["maxMoves"])
        tag = f"{fx['level']:<7} tohum {fx['seed']:>6}"
        problems = []
        if got["moves"] != fx["moves"]:
            # İlk ayrışan hamleyi bul (teşhis için)
            a, b = got["moves"], fx["moves"]
            i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
            problems.append(f"hamleler {i}. konumda ayrıştı (py={a[i:i+8]!r} ts={b[i:i+8]!r}, "
                            f"uzunluk py={len(a)} ts={len(b)})")
        if got["scores"] != fx["scores"]:
            i = next((i for i in range(min(len(got['scores']), len(fx['scores'])))
                      if got['scores'][i] != fx['scores'][i]), -1)
            problems.append(f"skor çizelgesi {i}. adımda ayrıştı "
                            f"(py={got['scores'][i] if i>=0 else '?'} ts={fx['scores'][i] if i>=0 else '?'})")
        if got["bests"] != fx["bests"]:
            problems.append("en büyük kare çizelgesi ayrıştı")
        if got["maxTile"] != fx["maxTile"]:
            problems.append(f"maxTile py={got['maxTile']} ts={fx['maxTile']}")
        if got["finalScore"] != fx["finalScore"]:
            problems.append(f"finalScore py={got['finalScore']} ts={fx['finalScore']}")

        if problems:
            fails += 1
            print(f"  ✗ {tag}: " + " · ".join(problems))
        else:
            print(f"  ✓ {tag}: {len(fx['moves'])} hamle, skor {fx['finalScore']} — birebir")

    print()
    if fails:
        print(f"PARİTE BOZUK: {fails}/{len(fixtures)} fixture ayrıştı")
        sys.exit(1)
    print(f"PARİTE TAM ✓ — {len(fixtures)} fixture, Python botu = TS botu (birebir)")


if __name__ == "__main__":
    main()
