"""econ — ekonomi ayarı doğrulama birim testi (saf, DB'siz).

Doğrular: aralık dışı REDDEDİLİR (kırpılmaz), tip denetimi, bilinmeyen anahtar,
effective() bozuk override'ı varsayılana düşürür, month-locked işareti.

Çalıştır:  python server/test_econ.py
"""
import sys

import econ

fails = []


def check(cond, label):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def main():
    ok, v, err = econ.validate("power_price.bomb", 50)
    check(ok and v == 50, "geçerli fiyat kabul")
    ok, v, err = econ.validate("power_price.bomb", 0)
    check(not ok and err == "out_of_range", "fiyat 0 REDDEDİLİR (aralık dışı)")
    ok, v, err = econ.validate("champion_prize_gold", 999999)
    check(not ok and err == "out_of_range", "ödül 999999 REDDEDİLİR")
    ok, v, err = econ.validate("level_reward_mult", 2.5)
    check(ok and abs(v - 2.5) < 1e-9, "çarpan 2.5 kabul (float)")
    ok, v, err = econ.validate("level_reward_mult", 0.05)
    check(not ok and err == "out_of_range", "çarpan 0.05 REDDEDİLİR (< min)")
    ok, v, err = econ.validate("power_price.bomb", "abc")
    check(not ok and err == "bad_type", "metin REDDEDİLİR")
    ok, v, err = econ.validate("power_price.bomb", 3.5)
    check(not ok and err == "bad_type", "int alanına ondalık REDDEDİLİR")
    ok, v, err = econ.validate("bogus.key", 1)
    check(not ok and err == "unknown_key", "bilinmeyen anahtar REDDEDİLİR")

    # effective: bozuk override varsayılana düşer
    eff = econ.effective({"power_price.bomb": 99, "power_price.time": 0, "champion_prize_gold": 5000})
    check(eff["power_price.bomb"] == 99, "geçerli override uygulanır (bomb=99)")
    check(eff["power_price.time"] == 30, "aralık dışı override varsayılana düşer (time=30)")
    check(eff["champion_prize_gold"] == 5000, "champion override uygulanır")
    check(eff["power_price.hint"] == 15, "override'sız anahtar varsayılan (hint=15)")

    # defaults tam
    d = econ.defaults()
    check(d["level_reward_mult"] == 1.0 and d["champion_prize_gold"] == 2000, "varsayılanlar doğru")

    # month-locked
    rows = {r["key"]: r for r in econ.spec_rows()}
    check(rows["champion_prize_gold"]["monthLocked"] is True, "champion_prize ay-kilitli")
    check(rows["power_price.bomb"]["monthLocked"] is False, "güç fiyatı ay-kilitli değil")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — ekonomi ayarı doğrulama")


if __name__ == "__main__":
    main()
