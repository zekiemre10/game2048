import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Ses / müzik servisi
//  Arka plan müziği (loop). Tercihler localStorage'da saklanır.
//  Tarayıcı autoplay engeli nedeniyle müzik, kullanıcının İLK
//  etkileşiminde başlatılır (tıklama/tuş).
//  Parça: "Calm Mind – Chill Lofi Beat" (FASSounds, Pixabay, ücretsiz).
// ============================================================

const MUSIC_ON_KEY = 'game2048.musicOn';
const VOLUME_KEY = 'game2048.musicVolume';

/**
 * Müzik dosyaları (yol <base href>'e göre çözülür). Modern tarayıcıya küçük
 * **Opus** (Ogg), desteklemeyene **mp3** yedeği sunulur → ilk indirilen veri en aza iner.
 */
const TRACK_OPUS = 'audio/calm-mind.ogg'; // Ogg/Opus — en küçük
const TRACK_MP3 = 'audio/calm-mind.mp3'; // evrensel yedek

/**
 * Tarayıcının çalabildiği en küçük biçimi seçer (Opus varsa onu, yoksa mp3).
 * canPlayType '' (çalamaz) / 'maybe' / 'probably' döner; boş değilse destekli sayılır.
 */
export function pickTrackSrc(canPlay: (type: string) => string): string {
  return canPlay('audio/ogg; codecs=opus') ? TRACK_OPUS : TRACK_MP3;
}

/** Varsayılan ses seviyesi (0..1). */
const DEFAULT_VOLUME = 0.4;

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio: HTMLAudioElement | null = null;

  /** Müzik açık mı? */
  readonly musicOn = signal<boolean>(loadMusicOn());

  /** Ses seviyesi (0..1). */
  readonly volume = signal<number>(loadVolume());

  constructor() {
    // Autoplay engeli: ilk kullanıcı etkileşiminde müziği başlat.
    if (typeof document !== 'undefined') {
      const kick = () => this.ensurePlaying();
      document.addEventListener('pointerdown', kick, { once: true });
      document.addEventListener('keydown', kick, { once: true });
      document.addEventListener('touchstart', kick, { once: true });
    }
  }

  /**
   * <audio> öğesini tembel oluşturur. `preload='none'` → öğe oluşturmak veri
   * İNDİRMEZ; müzik dosyası yalnızca çalmaya başlayınca (play → kullanıcı müziği
   * açınca) in/er. Böylece ilk açılışta müzik indirilmez.
   */
  private ensureAudio(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null; // SSR/test ortamı
    if (!this.audio) {
      const src = pickTrackSrc((t) =>
        typeof document !== 'undefined' ? new Audio().canPlayType(t) : '',
      );
      this.audio = new Audio(src);
      this.audio.loop = true;
      this.audio.volume = this.volume();
      this.audio.preload = 'none'; // ilk açılışta indirme; play() olunca yükle
      // DOM'a ekle (bazı tarayıcılarda daha güvenilir + test edilebilir)
      if (typeof document !== 'undefined' && document.body) {
        document.body.appendChild(this.audio);
      }
    }
    return this.audio;
  }

  /** İlk kullanıcı etkileşiminde çağrılır: müzik açıksa çalmaya başla. */
  ensurePlaying(): void {
    if (!this.musicOn()) return;
    const a = this.ensureAudio();
    if (a && a.paused) this.safePlay(a);
  }

  /** Müziği aç/kapat (kalıcı). */
  setMusicOn(on: boolean): void {
    this.musicOn.set(on);
    saveMusicOn(on);
    const a = this.ensureAudio();
    if (!a) return;
    if (on) this.safePlay(a);
    else a.pause();
  }

  /** play() bazı ortamlarda promise döndürmez; güvenli sarmalayıcı. */
  private safePlay(a: HTMLAudioElement): void {
    try {
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* autoplay engellenirse sessizce geç */
        });
      }
    } catch {
      /* jsdom/test: play uygulanmamış olabilir */
    }
  }

  /** Müziği tersine çevir. */
  toggleMusic(): void {
    this.setMusicOn(!this.musicOn());
  }

  /** Ses seviyesini ayarla (0..1, kalıcı). */
  setVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.volume.set(clamped);
    saveVolume(clamped);
    if (this.audio) this.audio.volume = clamped;
  }
}

// --- Kalıcılık (localStorage) -------------------------------

function loadMusicOn(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(MUSIC_ON_KEY);
    return raw === null ? true : raw === 'true'; // varsayılan: açık
  } catch {
    return true;
  }
}

function saveMusicOn(on: boolean): void {
  try {
    localStorage?.setItem(MUSIC_ON_KEY, String(on));
  } catch {
    /* yoksay */
  }
}

function loadVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_VOLUME;
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw === null ? DEFAULT_VOLUME : parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function saveVolume(v: number): void {
  try {
    localStorage?.setItem(VOLUME_KEY, String(v));
  } catch {
    /* yoksay */
  }
}
