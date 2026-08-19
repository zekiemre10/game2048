"""YZ (LLM) koç ayarları + maliyet tahmini — panelden yönetim için saf çekirdek.

Model/parametre/bütçe DEĞERLERİ burada doğrulanır ve maliyet tahmin edilir; ağ
çağrısı + anahtar app.py'de. **API ANAHTARI BURAYA GİRMEZ** — yalnız env'de
(GAME2048_LLM_KEY); ne DB'de, ne yanıtta, ne commit'te, ne logda.

Saf (DB'siz/ağsız) → test edilir. app.py bunu import eder → DEPLOY'da birlikte gönder.

⚠️ Fiyatlar TAHMİNDİR ($/milyon token) ve sağlayıcıda değişebilir; maliyet sayacı
bir güvenlik tahminidir, fatura değil. Bütçe tavanı bu tahmine göre oto-kapatır.
"""

# Panelden seçilebilir modeller (güvenli beyaz liste) + fiyat tahmini.
# fiyat: (girdi $/Mtok, çıktı $/Mtok)
MODELS = {
    # Anthropic
    "claude-haiku-4-5-20251001": {"provider": "anthropic", "price": (1.0, 5.0), "label": "Claude Haiku 4.5 (ucuz)"},
    "claude-sonnet-5": {"provider": "anthropic", "price": (3.0, 15.0), "label": "Claude Sonnet 5"},
    "claude-opus-5": {"provider": "anthropic", "price": (15.0, 75.0), "label": "Claude Opus 5 (pahalı)"},
    # OpenAI
    "gpt-4o-mini": {"provider": "openai", "price": (0.15, 0.60), "label": "GPT-4o mini (çok ucuz)"},
    "gpt-4o": {"provider": "openai", "price": (2.5, 10.0), "label": "GPT-4o"},
}

# key -> (default, min, max, tip). Bütçe pakette $10 (emir onayı) → ama ANAHTAR
# tanımlanana kadar özellik kapalı; bu yalnız tavandır.
SETTINGS_SPEC = {
    "llm.temperature": (0.7, 0.0, 1.0, "float"),
    "llm.max_tokens": (400, 64, 2000, "int"),
    "llm.budget_monthly_usd": (10.0, 0.0, 1000.0, "float"),
    "llm.enabled": (1, 0, 1, "int"),  # panelden aç/kapa (anahtar ayrı şart)
}


def provider_for(model: str) -> str:
    m = MODELS.get(model)
    return m["provider"] if m else "anthropic"


def estimate_cost(model: str, in_tokens: int, out_tokens: int) -> float:
    """Bir çağrının tahmini maliyeti (USD). Bilinmeyen model → 0 (tahmin yok)."""
    m = MODELS.get(model)
    if not m:
        return 0.0
    pin, pout = m["price"]
    return (int(in_tokens or 0) / 1_000_000) * pin + (int(out_tokens or 0) / 1_000_000) * pout


def validate_model(model: str):
    """(ok, model, err). Yalnız beyaz listedeki modeller."""
    if model in MODELS:
        return True, model, None
    return False, None, "unknown_model"


def _coerce(value, typ):
    if typ == "int":
        if isinstance(value, bool):
            return int(value)  # enabled true/false kabul
        if isinstance(value, float) and not value.is_integer():
            raise ValueError("not_int")
        return int(value)
    if isinstance(value, bool):
        raise ValueError("bool")
    return float(value)


def validate_setting(key: str, value):
    """(ok, coerced, err) — llm.* sayısal ayarları; aralık dışı REDDEDİLİR."""
    if key not in SETTINGS_SPEC:
        return False, None, "unknown_key"
    default, lo, hi, typ = SETTINGS_SPEC[key]
    try:
        v = _coerce(value, typ)
    except (ValueError, TypeError):
        return False, None, "bad_type"
    if v < lo or v > hi:
        return False, None, "out_of_range"
    return True, v, None


def setting_defaults() -> dict:
    return {k: spec[0] for k, spec in SETTINGS_SPEC.items()}


def effective_settings(overrides: dict) -> dict:
    """Varsayılan + geçerli override (bozuk/aralık dışı → varsayılana düşer)."""
    out = setting_defaults()
    for k, raw in (overrides or {}).items():
        if k in SETTINGS_SPEC:
            ok, v, _ = validate_setting(k, raw)
            if ok:
                out[k] = v
    return out
