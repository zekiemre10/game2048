import { Injectable, inject } from '@angular/core';
import { GameService } from './game.service';
import { I18nService } from './i18n.service';
import { API_BASE, AuthService } from './auth.service';
import { describeGame, findTurningPoint } from '../logic/ai';

// ============================================================
//  2048 — Yapay zekâ servisi
//  İki katman:
//   • localAnalysis() — algoritmik, anahtarsız, çevrimdışı (her zaman çalışır).
//   • coach() — kişiselleştirilmiş LLM koç. Sunucudaki /analysis uç noktasını
//     çağırır (API anahtarı YALNIZCA sunucuda). Giriş yoksa / sunucu erişilemezse
//     / anahtar ayarlı değilse sessizce localAnalysis'e düşer — hata gösterilmez.
// ============================================================

/** Oyun özeti — modele gönderilen tek veri (istemci başka bir şey uydurmaz). */
export interface GameSummary {
  mode: string;
  lang: 'tr' | 'en';
  score: number;
  moves: number;
  bestTile: number;
  accuracy: number;
  assistant: boolean;
  outcome: string;
  healthCurve: number[];
  turningPoint: { move: number; from: number; to: number } | null;
  inaccurateMoves: number[];
}

/** Koç sonucu: metin + kaynağı (LLM üretimi mi, yerel şablon mu). */
export interface CoachResult {
  text: string;
  ai: boolean;
}

/** Diziyi en fazla `max` noktaya eşit aralıkla seyreltir (ilk + son korunur). */
function downsample(arr: number[], max: number): number[] {
  const n = arr.length;
  if (n <= max) return arr.slice();
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.round((i * (n - 1)) / (max - 1))]);
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  /** Biten oyunu değerlendirir (köşe stratejisi, verimlilik, ipucu). */
  localAnalysis(): string {
    return describeGame(
      this.game.toValueGrid(),
      this.game.score(),
      this.game.moves(),
      // Tüm zamanların rekoru değil, BU oyunda ulaşılan en yüksek kare.
      this.game.currentBestTile(),
      this.i18n.lang(),
    );
  }

  /**
   * Modele gönderilecek oyun özetini kurar: mod, skor, hamle, en büyük kare,
   * doğruluk, dönüm noktası ve (bellek için) seyreltilmiş sağlık eğrisi. Zaman
   * çizelgesi paketinden gelen `moveTimeline` verisine dayanır.
   */
  buildSummary(): GameSummary {
    const tl = this.game.moveTimeline();
    const ti = findTurningPoint(tl);
    const assistant = this.game.assistantOn();
    return {
      mode: this.game.mode(),
      lang: this.i18n.lang(),
      score: this.game.score(),
      moves: this.game.moves(),
      bestTile: this.game.currentBestTile(),
      accuracy: this.game.accuracy(),
      assistant,
      outcome: this.game.status(),
      // Sağlık eğrisini en fazla 24 noktaya seyrelt (istem boyutu + maliyet).
      healthCurve: downsample(
        tl.map((p) => p.health),
        24,
      ),
      turningPoint:
        ti >= 1 ? { move: tl[ti].move, from: tl[ti - 1].health, to: tl[ti].health } : null,
      // Hatalı hamle numaraları yalnızca asistan açıkken anlamlı.
      inaccurateMoves: assistant
        ? tl
            .filter((p) => p.rating === 'inaccurate')
            .map((p) => p.move)
            .slice(0, 12)
        : [],
    };
  }

  /**
   * Kişiselleştirilmiş LLM koç metni. Misafir (giriş yok) / sunucu erişilemez /
   * anahtar ayarlı değil / hız sınırı dolu durumlarında yerel şablona düşer
   * (`ai:false`) — özellik hiçbir zaman hata göstermez.
   */
  async coach(): Promise<CoachResult> {
    const fallback = (): CoachResult => ({ text: this.localAnalysis(), ai: false });
    const headers = this.auth.authHeaders();
    if (!headers) return fallback(); // misafir → şablon (LLM yalnızca giriş yapanlara)
    try {
      const res = await fetch(`${API_BASE}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(this.buildSummary()),
      });
      if (!res.ok) return fallback(); // 401/429/503 → sessizce şablona düş
      const json = await res.json().catch(() => ({}));
      const text = typeof json.text === 'string' ? json.text.trim() : '';
      return text ? { text, ai: true } : fallback();
    } catch {
      return fallback(); // ağ hatası → şablon
    }
  }
}
