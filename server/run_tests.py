#!/usr/bin/env python3
"""
Python backend test koşucusu — bağımlılıksız (stdlib).

server/test_*.py dosyalarının her birini AYRI süreç olarak koşar (izolasyon:
her test kendi geçici DB'siyle kendi sunucusunu ayağa kaldırır), sonuçları
toplar. Herhangi biri düşerse çıkış kodu 1 → CI düşer.

Çalıştır:  python server/run_tests.py
"""
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
tests = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
env = dict(os.environ, PYTHONIOENCODING="utf-8")

failed = []
for path in tests:
    name = os.path.basename(path)
    print(f"\n=== {name} ===", flush=True)
    result = subprocess.run([sys.executable, path], env=env)
    if result.returncode != 0:
        failed.append(name)

print("\n" + "=" * 50)
if failed:
    print(f"BACKEND TESTLERİ BAŞARISIZ ({len(failed)}/{len(tests)}): {', '.join(failed)}")
    sys.exit(1)
print(f"TÜM BACKEND TESTLERİ GEÇTİ ✓ — {len(tests)} dosya")
