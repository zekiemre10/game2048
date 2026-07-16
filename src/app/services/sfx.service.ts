import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Ses efektleri (SFX)
//  Web Audio ile PROSEDÜREL üretilir → ses dosyası gerekmez,
//  offline çalışır, tek dosyayı şişirmez.
//  - playMove():  hamlede kısa "tık"
//  - playMerge(): birleşmede tatlı iki notalık "pop"
//  Efekt ses seviyesi localStorage'da saklanır.
// ============================================================

const SFX_VOLUME_KEY = 'game2048.sfxVolume';
const DEFAULT_SFX_VOLUME = 0.5;

interface Blip {
  freq: number;
  type: OscillatorType;
  dur: number;
  gain: number;
  delay?: number;
}

@Injectable({ providedIn: 'root' })
export class SfxService {
  private ctx: AudioContext | null = null;

  /** Efekt ses seviyesi (0..1). 0 → kapalı. */
  readonly sfxVolume = signal<number>(loadSfxVolume());

  /** Efekt ses seviyesini ayarla (0..1, kalıcı). */
  setVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.sfxVolume.set(clamped);
    saveSfxVolume(clamped);
  }

  /** Hamle sesi (kısa yumuşak tık). */
  playMove(): void {
    this.blip({ freq: 180, type: 'triangle', dur: 0.07, gain: 0.35 });
  }

  /** Birleşme sesi (yükselen iki nota). */
  playMerge(): void {
    this.blip({ freq: 440, type: 'sine', dur: 0.09, gain: 0.4 });
    this.blip({ freq: 660, type: 'sine', dur: 0.11, gain: 0.4, delay: 0.05 });
  }

  // --- Web Audio ----------------------------------------------

  /** AudioContext'i tembel oluşturur ve gerekirse devam ettirir. */
  private ensureCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null; // Web Audio yoksa (SSR/test) sessizce geç

    if (!this.ctx) this.ctx = new Ctor();
    // Autoplay: askıdaysa kullanıcı etkileşiminde devam ettir
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Tek bir kısa ton üretir (zarf: hızlı çıkış + üstel sönüm). */
  private blip({ freq, type, dur, gain, delay = 0 }: Blip): void {
    const vol = this.sfxVolume();
    if (vol <= 0) return; // kapalı

    const ctx = this.ensureCtx();
    if (!ctx) return;

    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

// --- Kalıcılık ----------------------------------------------

function loadSfxVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SFX_VOLUME;
    const raw = localStorage.getItem(SFX_VOLUME_KEY);
    const n = raw === null ? DEFAULT_SFX_VOLUME : parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_SFX_VOLUME;
  } catch {
    return DEFAULT_SFX_VOLUME;
  }
}

function saveSfxVolume(v: number): void {
  try {
    localStorage?.setItem(SFX_VOLUME_KEY, String(v));
  } catch {
    /* yoksay */
  }
}
