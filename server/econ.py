"""Ekonomi ayarları — panelden yönetilen az sayıda değer + KATI aralık denetimi.

⚠️ RİSKLİ ALAN. İlkeler (bkz. ADMIN.md):
- **Dar kapsam** (bilinçli): yalnız (1) seviye ödülü ÇARPANI, (2) beş güç fiyatı,
  (3) aylık şampiyonluk altını. Her şeyi açmak ekonomiyi kırılganlaştırır; gerçekten
  dengelenmesi gerekenlerle başlanır.
- **Aralık denetimi zorunlu**: aralık dışı değer (fiyat 0, ödül 999999) REDDEDİLİR
  — hem sunucu (burası, YETKİLİ) hem istemci. `clamp` değil `reject`: sessiz kırpma
  yöneticiyi yanıltır. Yalnız kayıtlı geçersizlik (eski/bozuk override) okunurken
  varsayılana düşülür.
- **Gömülü varsayılan**: sunucu erişilemezse oyun bu varsayılanlarla çalışır; ekonomi
  ayarı için oyun ASLA beklemez.
- **Oyuncu varlıkları etkilenmez**: bu değerler yalnız YENİ ödül/fiyat hesaplarına
  girer; mevcut altın/güç/envanter dokunulmaz.

Bu modül SAFtır (DB'siz) → test edilir. app.py bunu import eder → DEPLOY'da app.py
ILE birlikte gönderilmeli.
"""

# key -> (default, min, max, tip). Düz anahtarlar (nested power_price.* dahil).
SPEC = {
    "level_reward_mult": (1.0, 0.1, 5.0, "float"),   # tüm seviye altınlarını ölçekler
    "power_price.time": (30, 1, 500, "int"),
    "power_price.bomb": (40, 1, 500, "int"),
    "power_price.shuffle": (25, 1, 500, "int"),
    "power_price.undo": (20, 1, 500, "int"),
    "power_price.hint": (15, 1, 500, "int"),
    "champion_prize_gold": (2000, 100, 20000, "int"),
}

# Ay ortasında değiştirilemeyecek anahtarlar (yarış başladıysa reddedilir).
MONTH_LOCKED = ("champion_prize_gold",)


def defaults() -> dict:
    return {k: spec[0] for k, spec in SPEC.items()}


def _coerce(value, typ):
    if typ == "int":
        if isinstance(value, bool):
            raise ValueError("bool")
        if isinstance(value, float) and not value.is_integer():
            raise ValueError("not_int")
        return int(value)
    # float
    if isinstance(value, bool):
        raise ValueError("bool")
    return float(value)


def validate(key: str, value):
    """(ok, coerced_value, error). Aralık dışı → ok=False (REDDET, kırpma)."""
    if key not in SPEC:
        return False, None, "unknown_key"
    default, lo, hi, typ = SPEC[key]
    try:
        v = _coerce(value, typ)
    except (ValueError, TypeError):
        return False, None, "bad_type"
    if v < lo or v > hi:
        return False, None, "out_of_range"
    return True, v, None


def effective(overrides: dict) -> dict:
    """Varsayılan + GEÇERLİ override birleşimi. Kayıtlı bir override bozuk/aralık
    dışıysa (eski sürüm, elle bozma) sessizce VARSAYILANA düşülür — oyun kırılmaz."""
    out = defaults()
    for k, raw in (overrides or {}).items():
        ok, v, _ = validate(k, raw)
        if ok:
            out[k] = v
    return out


def spec_rows() -> list:
    """Panel edit ekranı için: her anahtarın varsayılan + aralığı + tipi."""
    return [
        {"key": k, "default": d, "min": lo, "max": hi, "type": t,
         "monthLocked": k in MONTH_LOCKED}
        for k, (d, lo, hi, t) in SPEC.items()
    ]
