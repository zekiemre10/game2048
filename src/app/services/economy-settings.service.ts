import { Injectable, signal } from '@angular/core';
import { API_BASE } from './auth.service';
import { POWERS, PowerId, powerDef } from '../models/power.model';

/**
 * Ekonomi AYARLARI okuma katmanı (⚖️): seviye ödülü çarpanı + güç fiyatları
 * sunucudan (panelden yönetilir) geçersiz kılınabilir. (Altın BAKİYESİ ayrı bir
 * servistir: EconomyService.) İlkeler:
 *
 * - **Oyun ASLA beklemez**: okuma çağrıları her zaman ANINDA döner (gömülü
 *   varsayılan → önbellek → sunucu). fetch arka planda; başarısızsa varsayılan.
 * - **Gömülü varsayılan**: sunucu erişilemezse oyun bunlarla çalışır (power.model
 *   fiyatları + çarpan 1.0).
 * - **İstemci de sınırlar** (savunma derinliği): sunucu bozuk/aşırı değer dönse
 *   bile clamp'lenir → ekonomi tek bir hatalı yanıtla bozulmaz.
 * - **Kısa önbellek**: /settings 30sn önbelleklenir (Cache-Control) + localStorage.
 */
const CACHE_KEY = 'game2048.econSettings';
const MULT_MIN = 0.1;
const MULT_MAX = 5;
const PRICE_MIN = 1;
const PRICE_MAX = 500;

@Injectable({ providedIn: 'root' })
export class EconomySettingsService {
  private readonly settings = signal<Record<string, number>>(embeddedDefaults());

  constructor() {
    this.loadCache(); // anında (önbellek varsa)
    void this.refresh(); // arka planda tazele (bloklamaz)
  }

  /** Seviye tamamlama altınına uygulanan çarpan (varsayılan 1.0). */
  levelRewardMult(): number {
    return clamp(this.settings()['level_reward_mult'] ?? 1, MULT_MIN, MULT_MAX);
  }

  /** Bir gücün güncel fiyatı (sunucu geçersiz kılması → clamp → gömülü varsayılan). */
  powerPrice(id: PowerId): number {
    const raw = this.settings()[`power_price.${id}`];
    const fallback = powerDef(id).price;
    const v = typeof raw === 'number' && isFinite(raw) ? raw : fallback;
    return Math.round(clamp(v, PRICE_MIN, PRICE_MAX));
  }

  /** Sunucudan ayarları çek (başarısızsa mevcut/gömülü değerleri KORU). */
  async refresh(): Promise<void> {
    // Birim testlerinde (jsdom) gerçek ağ çağrısı yapma → açık handle bırakıp
    // test sürecini bloklamasın (bkz. telemetry sendBeacon notu). Gerçek tarayıcı
    // + Playwright'ta normal çalışır.
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) return;
      const j = await res.json();
      if (j && j.settings && typeof j.settings === 'object') {
        const merged = { ...embeddedDefaults(), ...sanitize(j.settings) };
        this.settings.set(merged);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
        } catch {
          /* storage yoksa geç */
        }
      }
    } catch {
      /* ağ yok → gömülü varsayılan/önbellek KALIR, oyun çalışır */
    }
  }

  private loadCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        this.settings.set({ ...embeddedDefaults(), ...sanitize(JSON.parse(raw)) });
      }
    } catch {
      /* bozuk önbellek → gömülü varsayılan kalır */
    }
  }
}

/** Gömülü varsayılanlar: power.model fiyatları + çarpan 1.0. */
function embeddedDefaults(): Record<string, number> {
  const d: Record<string, number> = { level_reward_mult: 1 };
  for (const p of POWERS) d[`power_price.${p.id}`] = p.price;
  return d;
}

/** Yalnız bilinen sayı anahtarlarını al (hostile/bozuk yanıta karşı). */
function sanitize(obj: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = ['level_reward_mult', ...POWERS.map((p) => `power_price.${p.id}`)];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
