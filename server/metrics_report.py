#!/usr/bin/env python3
"""Metrik panosu — anlık JSON dökümü (salt-okunur).

Canlı DB'yi değiştirmeden `metrics.compute` çıktısını JSON basar. Pano ekranı
(ayrı admin uygulaması) `/admin/metrics` uçunu tüketir; bu CLI ise hızlı bakış
ve anlık görselleştirme (snapshot pano) için kullanılır. Kişisel veri basmaz.

Çalıştır:  python3 metrics_report.py [db_yolu] [from YYYY-MM-DD] [to YYYY-MM-DD]
           (aralık verilmezse son 30 gün)
"""
import json
import os
import sys

import metrics


def main():
    db = os.environ.get("GAME2048_DB") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "app.db")
    args = [a for a in sys.argv[1:]]
    if args and not args[0].count("-") == 2:  # ilk arg db yolu olabilir
        db = args.pop(0)
    to = args[1] if len(args) > 1 else metrics.today()
    frm = args[0] if len(args) > 0 else metrics._day_add(to, -29)

    import sqlite3
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    metrics.flush_counters(conn)
    data = metrics.compute(conn, frm, to, db_path=db)
    conn.close()
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
