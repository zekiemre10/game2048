"""
Python replay motoru parite testi.

server/replay_fixtures.json içindeki transkriptler istemci mantığıyla
(scripts/gen-replay-fixtures.mjs) üretilmiştir. Python replay_game HER
transkript için AYNI skor ve en büyük kareyi vermelidir.

Çalıştır:  python3 server/test_replay_parity.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay import replay_game  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "replay_fixtures.json")


def main():
    with open(FIXTURES, encoding="utf-8") as f:
        fixtures = json.load(f)

    fails = 0
    longest = 0
    for i, fx in enumerate(fixtures):
        r = replay_game(fx["seed"], fx["moves"], fx["size"])
        longest = max(longest, len(fx["moves"]))
        if not r["valid"]:
            print(f"  [{i}] GECERSIZ (beklenmedik): seed={fx['seed']}")
            fails += 1
            continue
        if r["score"] != fx["score"]:
            print(
                f"  [{i}] SKOR FARKI: py={r['score']} != js={fx['score']} "
                f"(seed={fx['seed']} size={fx['size']} moves={len(fx['moves'])})"
            )
            fails += 1
        if r["maxTile"] != fx["maxTile"]:
            print(
                f"  [{i}] MAXTILE FARKI: py={r['maxTile']} != js={fx['maxTile']}"
            )
            fails += 1

    total = len(fixtures)
    if fails:
        print(f"\n[X] PARITE BASARISIZ: {fails} uyusmazlik / {total} fixture")
        sys.exit(1)
    print(
        f"[OK] PARITE TAM: {total} fixture, en uzun oyun {longest} hamle - "
        f"Python replay = istemci mantigi (birebir)"
    )


if __name__ == "__main__":
    main()
