"""
Günlük tohum takvimi — küratörlü takvim + formül yedeği (birim testi).

Doğrular:
  1. Takvimde ≥1 yıllık (≥365) tohum var; startDay geçerli.
  2. daily_seed başlangıç gününde takvimin ilk tohumunu, ardışık günlerde
     sıradaki tohumu döndürür (belirleyici).
  3. Takvim ÖNCESİ/SONRASI günler FORMÜLE (_formula_seed) düşer.
  4. PARİTE: sunucu daily_calendar.json = istemci daily-calendar.data.ts (birebir)
     → aynı gün herkes (istemci+sunucu) aynı tohumu üretir, replay tutar.

Çalıştır:  python server/test_daily_calendar.py
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import app  # noqa: E402


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    cal = app._DAILY_CALENDAR
    seeds = cal["seeds"]
    start = cal["startDay"]

    check(len(seeds) >= 365, f"takvimde ≥365 tohum var ({len(seeds)})")
    check(bool(re.match(r"^\d{4}-\d{2}-\d{2}$", start or "")), f"startDay geçerli ({start})")

    # Takvim günleri → sıradaki tohum
    check(app.daily_seed(start) == seeds[0], "başlangıç günü ilk tohumu verir")
    check(app.daily_seed(add_days(start, 1)) == seeds[1], "ardışık gün sıradaki tohumu verir")
    check(app.daily_seed(add_days(start, 100)) == seeds[100], "100. gün 100. tohumu verir")

    # Takvim öncesi/sonrası → formül yedeği
    before = add_days(start, -1)
    check(app.daily_seed(before) == app._formula_seed(before), "takvim ÖNCESİ gün formüle düşer")
    after = add_days(start, len(seeds) + 5)
    check(app.daily_seed(after) == app._formula_seed(after), "takvim SONRASI gün formüle düşer")

    # Belirleyici
    d = add_days(start, 42)
    check(app.daily_seed(d) == app.daily_seed(d), "belirleyici: aynı gün aynı tohum")

    # PARİTE: sunucu JSON = istemci TS (seed dizisi + startDay birebir)
    with open(os.path.join(HERE, "daily_calendar.json"), encoding="utf-8") as f:
        server_json = json.load(f)
    ts_path = os.path.join(HERE, "..", "src", "app", "logic", "daily-calendar.data.ts")
    with open(ts_path, encoding="utf-8") as f:
        ts = f.read()
    ts_start = re.search(r"startDay:\s*'([^']+)'", ts).group(1)
    ts_seeds = json.loads(re.search(r"seeds:\s*(\[[^\]]*\])", ts).group(1))
    check(ts_start == server_json["startDay"], "startDay istemci=sunucu")
    check(ts_seeds == server_json["seeds"], "seed dizisi istemci=sunucu (birebir)")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — küratörlü takvim + formül yedeği + parite")


if __name__ == "__main__":
    main()
