"""
YZ koç yönetimi — model bağlama + maliyet + bütçe/oto-kapatma testi.

Ağ YOK: urllib.request.urlopen monkeypatch'lenir (sahte sağlayıcı yanıtı + usage).
Böylece llm_complete'in GERÇEK mantığı (bütçe kontrolü + kullanım kaydı) test edilir.

Doğrular:
  1. YETKİ: normal kullanıcı /admin/llm* uçlarına 403.
  2. GET /admin/llm: config + model listesi + kullanım; ANAHTAR yanıtta YOK (keyPresent bool).
  3. Panelden model/param/bütçe değişir (yeniden başlatma yok); aralık dışı REDDEDİLİR.
  4. Canlı test seçili modele istek atar; kullanım+maliyet sayaçları GERÇEK kullanımı gösterir.
  5. OTO-KAPATMA: düşük bütçeyle tetiklenir (503), bütçe geri alınınca yeniden çalışır.
  6. ANAHTAR hiçbir yanıtta yok; anahtar yokken özellik sessizce kapalı (503 no_key).

Çalıştır:  python server/test_llm_admin.py
"""
import json
import os
import sys
import tempfile
import threading
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["GAME2048_DB"] = _tmp.name

import app  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

app.init_db()

# Sahte sağlayıcı: anthropic biçimli yanıt + usage (100 girdi / 20 çıktı token).
SECRET_KEY = "sk-test-SECRET-do-not-leak"
app.ANALYSIS_API_KEY = SECRET_KEY


class _FakeResp:
    def __init__(self, body):
        self._b = body
    def read(self):
        return json.dumps(self._b).encode()
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


_real_urlopen = urllib.request.urlopen


def _fake_urlopen(req, timeout=None):
    # Yalnız SAĞLAYICI URL'sini taklit et; test sunucusuna (localhost) gerçek çağrı.
    url = getattr(req, "full_url", str(req))
    if "anthropic.com" in url or "openai.com" in url:
        return _FakeResp({
            "content": [{"type": "text", "text": "OK"}],
            "usage": {"input_tokens": 100, "output_tokens": 20},
        })
    return _real_urlopen(req, timeout) if timeout is not None else _real_urlopen(req)


app.urllib.request.urlopen = _fake_urlopen  # yalnız sağlayıcı çağrısı sahte

_srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
PORT = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"


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


def register(u, p="parola123"):
    st, j = call("POST", "/register", {"username": u, "password": p, "email": f"{u}@test.com", "data": {}})
    assert st == 200, f"{st} {j}"
    return j["token"], j["user"]["id"]


def promote_admin(u):
    conn = app.db(); conn.execute("UPDATE users SET role='admin' WHERE username_lower=?", (u.lower(),)); conn.commit(); conn.close()


def main():
    fails = []
    def check(name, cond, detail=""):
        print(f"{'OK ' if cond else 'X  '} {name}{'' if cond else '  -> ' + detail}")
        if not cond:
            fails.append(name)

    tu, U = register("normal")
    ta, A = register("llmadmin"); promote_admin("llmadmin")

    # --- 1) YETKİ ---
    st, _ = call("GET", "/admin/llm", token=tu)
    check("normal kullanıcı /admin/llm 403", st == 403, str(st))
    st, _ = call("POST", "/admin/llm/settings", {"model": "gpt-4o-mini"}, tu)
    check("normal kullanıcı ayar değiştiremez 403", st == 403, str(st))

    # --- 2) GET /admin/llm: anahtar sızmıyor ---
    st, j = call("GET", "/admin/llm", token=ta)
    check("GET 200 + config/models/usage", st == 200 and "config" in j and "models" in j and "usage" in j, str(list(j.keys())))
    check("keyPresent True ama ANAHTAR yok", j["config"].get("keyPresent") is True and "key" not in j["config"], str(j["config"]))
    check("yanıtta ham anahtar YOK", SECRET_KEY not in json.dumps(j), "SIZINTI!")

    # --- 3) Panelden değişiklik (yeniden başlatma yok) + aralık denetimi ---
    st, j = call("POST", "/admin/llm/settings", {"model": "gpt-4o-mini", "budgetMonthlyUsd": 10.0}, ta)
    check("model değişir (gpt-4o-mini)", st == 200 and j["config"]["model"] == "gpt-4o-mini" and j["config"]["provider"] == "openai", f"{st} {j}")
    st, j = call("POST", "/admin/llm/settings", {"model": "bogus-model"}, ta)
    check("bilinmeyen model reddedilir", st == 400 and j.get("error") == "unknown_model", f"{st} {j}")
    st, j = call("POST", "/admin/llm/settings", {"budgetMonthlyUsd": 99999}, ta)
    check("aralık dışı bütçe reddedilir", st == 400 and j.get("error") == "out_of_range", f"{st} {j}")
    st, j = call("POST", "/admin/llm/settings", {"temperature": 5}, ta)
    check("aralık dışı temperature reddedilir", st == 400 and j.get("error") == "out_of_range", f"{st} {j}")
    # geri anthropic haiku'ya al (fiyatı belli)
    call("POST", "/admin/llm/settings", {"model": "claude-haiku-4-5-20251001", "budgetMonthlyUsd": 10.0, "enabled": 1}, ta)

    # --- 4) Canlı test + maliyet sayaçları ---
    st, j = call("POST", "/admin/llm/test", {}, ta)
    check("canlı test 200 + yanıt 'OK'", st == 200 and j.get("response") == "OK", f"{st} {j}")
    check("çağrı maliyeti > 0", j.get("callCostUsd", 0) > 0, str(j.get("callCostUsd")))
    st, j = call("GET", "/admin/llm", token=ta)
    check("sayaçlar gerçek kullanımı gösterir (istek>=1, token>0, cost>0)",
          j["usage"]["requests"] >= 1 and j["usage"]["inTokens"] >= 100 and j["usage"]["cost"] > 0, str(j["usage"]))

    # --- 5) OTO-KAPATMA: düşük bütçe → tetiklen → geri al ---
    cur_cost = j["usage"]["cost"]
    st, _ = call("POST", "/admin/llm/settings", {"budgetMonthlyUsd": round(cur_cost / 2, 6)}, ta)  # mevcut maliyetin altı
    st, j = call("POST", "/admin/llm/test", {}, ta)
    check("bütçe aşımında oto-kapatma (503)", st == 503 and j.get("error") == "unavailable_or_over_budget", f"{st} {j}")
    st, j = call("GET", "/admin/llm", token=ta)
    check("overBudget True + active False", j["overBudget"] is True and j["active"] is False, str({"o": j["overBudget"], "a": j["active"]}))
    # bütçeyi geri al → yeniden çalışır
    call("POST", "/admin/llm/settings", {"budgetMonthlyUsd": 10.0}, ta)
    st, j = call("POST", "/admin/llm/test", {}, ta)
    check("bütçe geri alınınca yeniden çalışır", st == 200 and j.get("response") == "OK", f"{st} {j}")

    # --- 6) Anahtar yokken sessizce kapalı ---
    app.ANALYSIS_API_KEY = ""  # anahtarı kaldır
    st, j = call("POST", "/admin/llm/test", {}, ta)
    check("anahtar yokken test 503 no_key", st == 503 and j.get("error") == "no_key", f"{st} {j}")
    st, j = call("GET", "/admin/llm", token=ta)
    check("anahtar yokken active False + keyPresent False", j["active"] is False and j["config"]["keyPresent"] is False, str(j["config"]))
    app.ANALYSIS_API_KEY = SECRET_KEY  # eski hâle

    print()
    if fails:
        print(f"BAŞARISIZ: {len(fails)} -> {fails}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✓ — YZ koç yönetimi (model+maliyet+bütçe)")


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            os.unlink(_tmp.name)
        except OSError:
            pass
