"""
LLM koç (/analysis) — entegrasyon + birim testi.

Doğrular:
  1. Auth zorunlu — token yoksa 401 (misafirler şablona düşer).
  2. Sağlayıcı metin dönerse 200 {text, ai:true}.
  3. Sağlayıcı hata/zaman aşımı (None) → 503 coach_unavailable (istemci şablona düşer).
  4. Sunucuda anahtar yoksa → 503 coach_unavailable (rate_ok'tan ÖNCE, çağrı yok).
  5. Maliyet: kısa pencere (burst) sınırı aşılınca 429.
  6. Aşırı uzun çıktı ANALYSIS_MAX_CHARS'a kırpılır.
  7. clamp_summary uydurma/aşırı değerleri güvenli aralığa sıkıştırır.
  8. Grounding sözleşmesi: istem yalnızca verilen sayılara dayanır ve "uydurma"
     talimatı içerir (tutarsız bilgi denetimi).

Ağ YOK: modül düzeyindeki llm_complete monkeypatch'lenir.

Çalıştır:  python server/test_analysis.py
"""
import json
import os
import sys
import tempfile
import threading
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["GAME2048_DB"] = _tmp.name
# Koçu etkinleştir (anahtar VARMIŞ gibi) — gerçek çağrı monkeypatch'le engellenir.
os.environ["GAME2048_LLM_KEY"] = "test-key"
os.environ["GAME2048_LLM_PROVIDER"] = "anthropic"

import app  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

app.init_db()
_srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
PORT = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"

# Sağlayıcı çağrısını sabit metinle değiştir (ağ yok). Testler bunu değiştirir.
_LLM = {"fn": lambda system, user: "Test koç metni."}
app.llm_complete = lambda system, user: _LLM["fn"](system, user)


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def reg(name):
    st, j = call("POST", "/register", {"username": name, "password": "parola123",
                                       "email": f"{name}@b.com", "data": {}})
    return j.get("token")


SUMMARY = {
    "mode": "classic", "lang": "tr", "score": 4200, "moves": 210,
    "bestTile": 512, "accuracy": 78, "assistant": True, "outcome": "lost",
    "healthCurve": [90, 88, 85, 40, 38, 30],
    "turningPoint": {"move": 38, "from": 85, "to": 40},
    "inaccurateMoves": [38, 91],
}


def main():
    fails = []

    def check(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    tok = reg("coachuser")
    check(bool(tok), "kullanıcı kaydedildi")

    # 1. Auth zorunlu
    st, j = call("POST", "/analysis", SUMMARY, token=None)
    check(st == 401 and j.get("error") == "unauthorized", f"token yoksa 401 ({st})")

    # 2. Başarılı — sağlayıcı metin döndürür
    st, j = call("POST", "/analysis", SUMMARY, token=tok)
    check(st == 200 and j.get("ai") is True and j.get("text") == "Test koç metni.",
          f"sağlayıcı metni 200 ile döndü ({st})")

    # 6. Uzun çıktı kırpılır
    _LLM["fn"] = lambda s, u: "x" * 5000
    st, j = call("POST", "/analysis", SUMMARY, token=tok)
    check(st == 200 and len(j.get("text", "")) <= app.ANALYSIS_MAX_CHARS + 1,
          f"aşırı uzun çıktı ANALYSIS_MAX_CHARS'a kırpıldı ({len(j.get('text',''))})")
    _LLM["fn"] = lambda s, u: "Test koç metni."

    # 3. Sağlayıcı None → 503 (istemci şablona düşer) — yeni kullanıcı (burst tüketme)
    tokB = reg("coachnone")
    _LLM["fn"] = lambda s, u: None
    st, j = call("POST", "/analysis", SUMMARY, token=tokB)
    check(st == 503 and j.get("error") == "coach_unavailable",
          f"sağlayıcı hatası 503 coach_unavailable ({st})")
    _LLM["fn"] = lambda s, u: "Test koç metni."

    # 4. Anahtar yoksa 503 (rate_ok'tan ÖNCE) — modül globalini geçici boşalt
    tokC = reg("coachnokey")
    saved = app.ANALYSIS_API_KEY
    app.ANALYSIS_API_KEY = ""
    st, j = call("POST", "/analysis", SUMMARY, token=tokC)
    check(st == 503 and j.get("error") == "coach_unavailable",
          f"anahtar yoksa 503 coach_unavailable ({st})")
    app.ANALYSIS_API_KEY = saved

    # 5. Burst sınırı: ANALYSIS_BURST_MAX aşılınca 429
    tokD = reg("coachburst")
    statuses = [call("POST", "/analysis", SUMMARY, token=tokD)[0]
                for _ in range(app.ANALYSIS_BURST_MAX + 3)]
    check(statuses[0] == 200 and 429 in statuses,
          f"burst sınırı aşılınca 429 ({statuses})")

    # 7. clamp_summary — uydurma/aşırı değerler güvenli aralığa
    clamped = app.clamp_summary({
        "mode": "x" * 99, "lang": "EN", "score": 10 ** 12, "moves": -5,
        "bestTile": 10 ** 9, "accuracy": 999, "assistant": "yes",
        "healthCurve": list(range(200)),  # 200 eleman → 24'e kırpılmalı
        "turningPoint": {"move": 10, "from": 500, "to": -3},
        "inaccurateMoves": list(range(50)),
    })
    check(clamped["score"] == app.MAX_SCORE, "aşırı skor MAX_SCORE'a sıkıştırıldı")
    check(clamped["moves"] == 0, "negatif hamle 0'a sıkıştırıldı")
    check(clamped["accuracy"] == 100, "accuracy 100'e sıkıştırıldı")
    check(clamped["lang"] == "en", "lang EN→en normalize edildi")
    check(len(clamped["healthCurve"]) == 24, "sağlık eğrisi 24 noktaya kırpıldı")
    check(len(clamped["mode"]) <= 16, "mode 16 karaktere kırpıldı")
    check(clamped["turningPoint"]["from"] == 100 and clamped["turningPoint"]["to"] == 0,
          "dönüm noktası 0-100 aralığına sıkıştırıldı")
    check(len(clamped["inaccurateMoves"]) == 12, "hatalı hamle listesi 12'ye kırpıldı")

    # 8. Grounding sözleşmesi: istem yalnızca verilen sayılara dayanır + uydurma yasağı
    sys_tr, usr_tr = app.build_coach_prompt(app.clamp_summary(SUMMARY))
    check("uydurma" in sys_tr.lower() or "uydur" in sys_tr.lower(),
          "TR istem 'uydurma' yasağı içeriyor")
    check("4200" in usr_tr and "38" in usr_tr,
          "istem gerçek oyun sayılarını (skor/dönüm) içeriyor")
    sys_en, usr_en = app.build_coach_prompt(app.clamp_summary({**SUMMARY, "lang": "en"}))
    check("never invent" in sys_en.lower() or "invent" in sys_en.lower(),
          "EN istem 'never invent' yasağı içeriyor")

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} kontrol geçmedi")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — LLM koç uç noktası")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
