#!/usr/bin/env python3
"""Skor tablosu — İLK TEMİZLİK RAPORU (salt-okunur tarama).

Canlı DB'yi DEĞİŞTİRMEDEN tüm skor tablolarını (aylık: tüm aylar, tüm-zamanlar,
günlük: bugün) `score_audit` ile tarar ve İŞARETLİ kayıtları döker. Yönetici bu
raporla elle `/admin/scores/invalidate` kararı verir (bu araç hiçbir şey silmez/
geçersiz kılmaz).

Çalıştır:  python3 score_report.py [db_yolu]
           (db_yolu verilmezse GAME2048_DB ya da ./app.db)
"""
import json
import os
import sqlite3
import sys
import time

import score_audit as sa


def _bestscore(data):
    try:
        d = json.loads(data or "{}")
    except Exception:
        d = {}
    return int(d.get("bestScore") or 0), int(d.get("bestTile") or 0)


def _active_invalid(conn, scope, period):
    try:
        rows = conn.execute(
            "SELECT user_id FROM score_invalidations "
            "WHERE scope=? AND period=? AND reverted=0", (scope, period)
        ).fetchall()
        return {r[0] for r in rows}
    except sqlite3.OperationalError:
        return set()  # tablo henüz yoksa


def scan(conn):
    groups = {"monthly": [], "alltime": [], "daily": []}

    months = [r[0] for r in conn.execute(
        "SELECT DISTINCT month FROM monthly_scores ORDER BY month DESC"
    ).fetchall()]
    for m in months:
        rows = conn.execute(
            "SELECT user_id, username, score, best FROM monthly_scores "
            "WHERE month=? ORDER BY score DESC", (m,)
        ).fetchall()
        second = rows[1][2] if len(rows) > 1 else None
        invalid = _active_invalid(conn, "monthly", m)
        for uid, uname, score, best in rows:
            flags = sa.analyze_record(score, best, moves=None, field_second=second)
            if flags:
                groups["monthly"].append((m, uid, uname, score, best, None, flags,
                                          uid in invalid))

    people = []
    for uid, uname, data in conn.execute("SELECT id, username, data FROM users"):
        bs, bt = _bestscore(data)
        if bs > 0:
            people.append((uid, uname, bs, bt))
    people.sort(key=lambda p: -p[2])
    second = people[1][2] if len(people) > 1 else None
    invalid = _active_invalid(conn, "alltime", "")
    for uid, uname, bs, bt in people:
        flags = sa.analyze_record(bs, bt, moves=None, field_second=second)
        if flags:
            groups["alltime"].append(("", uid, uname, bs, bt, None, flags,
                                      uid in invalid))

    today = time.strftime("%Y-%m-%d", time.gmtime())
    rows = conn.execute(
        "SELECT user_id, username, score, best, moves FROM daily_scores "
        "WHERE day=? ORDER BY score DESC", (today,)
    ).fetchall()
    second = rows[1][2] if len(rows) > 1 else None
    invalid = _active_invalid(conn, "daily", today)
    for uid, uname, score, best, moves in rows:
        flags = sa.analyze_record(score, best, moves=moves, field_second=second)
        if flags:
            groups["daily"].append((today, uid, uname, score, best, moves, flags,
                                    uid in invalid))
    return groups


def main():
    db = (sys.argv[1] if len(sys.argv) > 1
          else os.environ.get("GAME2048_DB")
          or os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.db"))
    conn = sqlite3.connect(db)
    groups = scan(conn)
    conn.close()

    total = sum(len(v) for v in groups.values())
    print("=" * 64)
    print(f"SKOR TABLOSU — İLK TEMİZLİK RAPORU  ({db})")
    print("=" * 64)
    for scope in ("monthly", "alltime", "daily"):
        recs = groups[scope]
        imp = sum(1 for r in recs if sa.worst_severity(r[6]) == "impossible")
        print(f"\n[{scope}]  işaretli: {len(recs)}  (imkansiz: {imp}, supheli: {len(recs)-imp})")
        for period, uid, uname, score, best, moves, flags, inv in recs:
            sev = sa.worst_severity(flags)
            tag = " [ZATEN GECERSIZ]" if inv else ""
            mv = f", {moves} hamle" if moves is not None else ""
            print(f"  - {sev.upper():10} {uname}#{uid} [{period}] "
                  f"skor={score}, kare={best}{mv}{tag}")
            for f in flags:
                print(f"      · {f['code']}: {f['detail']}")
    print(f"\nTOPLAM İŞARETLİ: {total}")
    if total == 0:
        print("Temiz — işaretli kayıt yok.")


if __name__ == "__main__":
    main()
