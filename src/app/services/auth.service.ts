import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GameService } from './game.service';

// ============================================================
//  2048 — Hesap servisi (kayıt / giriş)
//  Backend: http://34.158.136.9/emre/2048/api
//  Token localStorage'da; giriş yapınca ilerleme hesapla senkronlanır.
// ============================================================

/** Backend kök adresi (prod/localhost/file:// hepsinden çalışsın diye tam URL). */
export const API_BASE = 'http://34.158.136.9/emre/2048/api';
const API = API_BASE;
const TOKEN_KEY = 'game2048.token';

export interface AuthUser {
  id: number;
  username: string;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly game = inject(GameService);

  private token: string | null = loadToken();

  /** Giriş yapan kullanıcı (yoksa null). */
  readonly user = signal<AuthUser | null>(null);

  /** İşlem sürüyor mu (buton durumu için). */
  readonly busy = signal<boolean>(false);

  readonly isLoggedIn = computed(() => this.user() !== null);

  /** Diğer servisler (arkadaşlar/sohbet) için yetki başlığı; giriş yoksa null. */
  authHeaders(): Record<string, string> | null {
    return this.token ? { Authorization: `Bearer ${this.token}` } : null;
  }

  /** Otomatik yükleme için geciktirme zamanlayıcısı. */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hesaptaki veri UYGULANANA kadar yükleme yapılmaz. Aksi hâlde açılışta
   * boş yerel durum sunucuya yazılıp hesaptaki ilerlemeyi silebilirdi.
   */
  private syncReady = false;

  constructor() {
    // Sayfa açılışında token varsa oturumu geri yükle
    if (this.token) void this.refresh();
    else this.syncReady = true; // misafir: yükleyecek hesap yok

    // İlerleme değiştikçe buluta yaz. Daha önce yükleme YALNIZCA çıkış
    // yaparken olduğu için sekmeyi kapatan herkes o oturumun ilerlemesini
    // kaybediyordu (açılışta /me eski anlık görüntüyle üzerine yazıyordu).
    effect(() => {
      const snapshot = this.game.accountSnapshot(); // kalıcı sinyalleri izler
      if (!this.token || !this.syncReady) return;
      this.scheduleSync(snapshot);
    });

    // Sekme kapanırken/gizlenirken bekleyen yazmayı hemen gönder.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushSync();
      });
      window.addEventListener('pagehide', () => this.flushSync());
    }
  }

  /** Yükleme isteğini geciktirir (art arda değişikliklerde tek istek). */
  private scheduleSync(snapshot: Record<string, unknown>): void {
    this.pendingSnapshot = snapshot;
    if (typeof setTimeout === 'undefined') return;
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncUp();
    }, 2500);
  }

  /** Bekleyen yükleme varsa gecikmeyi beklemeden gönderir. */
  private flushSync(): void {
    if (this.syncTimer === null) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    void this.syncUp();
  }

  /** En son gönderilmeyi bekleyen anlık görüntü. */
  private pendingSnapshot: Record<string, unknown> | null = null;

  /** Kayıt ol — mevcut yerel ilerlemeyi hesaba taşır. */
  async register(username: string, password: string, email = ''): Promise<AuthResult> {
    return this.auth('register', username, password, this.game.accountSnapshot(), email);
  }

  /** Giriş yap — hesaptaki ilerlemeyi uygular. */
  async login(username: string, password: string): Promise<AuthResult> {
    return this.auth('login', username, password);
  }

  private async auth(
    endpoint: 'register' | 'login',
    username: string,
    password: string,
    data?: unknown,
    email?: string,
  ): Promise<AuthResult> {
    this.busy.set(true);
    try {
      const res = await fetch(`${API}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email, data }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: json.error || 'error' };

      this.setToken(json.token);
      this.user.set(json.user);
      if (endpoint === 'login') await this.refresh(); // hesaptaki veriyi uygula
      else this.syncReady = true; // kayıtta yerel ilerleme zaten yüklendi
      return { ok: true };
    } catch {
      return { ok: false, error: 'network' };
    } finally {
      this.busy.set(false);
    }
  }

  /** /me çağır: kullanıcıyı + hesaptaki ilerlemeyi getir/uygula. */
  async refresh(): Promise<void> {
    if (!this.token) return;
    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        if (res.status === 401) this.clear();
        return;
      }
      const json = await res.json();
      this.user.set(json.user);
      if (json.data && typeof json.data === 'object') {
        this.game.applyAccountSnapshot(json.data);
      }
      // Hesap verisi uygulandı → artık yerelden buluta yazmak güvenli.
      this.syncReady = true;
    } catch {
      /* çevrimdışı — sessiz geç */
    }
  }

  /** Yerel ilerlemeyi hesaba yükle (giriş varsa). */
  async syncUp(): Promise<void> {
    if (!this.token) return;
    const data = this.pendingSnapshot ?? this.game.accountSnapshot();
    this.pendingSnapshot = null;
    try {
      await fetch(`${API}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ data }),
        // Sekme kapanırken de isteğin tamamlanmasını sağlar.
        keepalive: true,
      });
    } catch {
      /* sessiz */
    }
  }

  /** Çıkış yap. */
  async logout(): Promise<void> {
    await this.syncUp(); // son durumu kaydet
    if (this.token) {
      try {
        await fetch(`${API}/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } catch {
        /* sessiz */
      }
    }
    this.clear();
  }

  private setToken(t: string): void {
    this.token = t;
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* yoksay */
    }
  }

  private clear(): void {
    this.token = null;
    this.syncReady = false;
    this.pendingSnapshot = null;
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.user.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* yoksay */
    }
  }
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
