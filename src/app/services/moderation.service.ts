import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';

/** Kullanıcıya gösterilen moderasyon bildirimi (sunucu `/moderation/notices`). */
export interface ModNotice {
  id: number;
  action: string; // 'warn' | 'mute' | 'unmute' | 'suspend' | 'unsuspend'
  reason: string;
  until: number; // susturma bitişi (unix sn); 0 = süresiz/yok
  created: number;
}

interface NoticesResponse {
  notices?: ModNotice[];
  muted_until?: number;
  suspended?: boolean;
}

const SEEN_KEY = 'game2048.modNoticesSeen';

/**
 * Moderasyon bildirimleri: kullanıcıya "susturuldun/uyarıldın: sebep" gibi
 * bilgileri sebebiyle gösterir (gizlilik + itiraz akışının kullanıcı ayağı).
 * Sunucu tarafı `/moderation/notices` (bkz. server/ADMIN.md).
 */
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly auth = inject(AuthService);

  readonly notices = signal<ModNotice[]>([]);
  readonly mutedUntil = signal(0);
  readonly suspended = signal(false);

  /** Kullanıcının gördüğünü (kapattığını) işaretlediği bildirim kimlikleri. */
  private readonly seen = signal<Set<number>>(loadSeen());

  /** Şu an aktif susturma var mı (bitiş gelecekte mi)? */
  readonly isMuted = computed(() => this.mutedUntil() * 1000 > Date.now());

  /** Gösterilecek en güncel, henüz kapatılmamış bildirim (yoksa null). */
  readonly latest = computed<ModNotice | null>(() => {
    const unseen = this.notices().filter((n) => !this.seen().has(n.id));
    if (unseen.length === 0) return null;
    return unseen.reduce((a, b) => (b.created > a.created ? b : a));
  });

  private polling = false;

  constructor() {
    // Girişte çek, çıkışta temizle.
    effect(() => {
      if (this.auth.isLoggedIn()) {
        void this.refresh();
        this.startPolling();
      } else {
        this.notices.set([]);
        this.mutedUntil.set(0);
        this.suspended.set(false);
      }
    });
  }

  /** Bildirimleri sunucudan çek. */
  async refresh(): Promise<void> {
    const headers = this.auth.authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${API_BASE}/moderation/notices`, { headers });
      if (!res.ok) return;
      const j = (await res.json()) as NoticesResponse;
      this.notices.set(Array.isArray(j.notices) ? j.notices : []);
      this.mutedUntil.set(Number(j.muted_until) || 0);
      this.suspended.set(!!j.suspended);
    } catch {
      // sessizce geç — bildirim kritik yol değil
    }
  }

  /** Bildirimi kullanıcı gördü → bir daha banner'da gösterme. */
  dismiss(id: number): void {
    this.seen.update((s) => {
      const next = new Set(s);
      next.add(id);
      persistSeen(next);
      return next;
    });
  }

  private startPolling(intervalMs = 60000): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (!this.auth.isLoggedIn()) {
        this.polling = false;
        return;
      }
      await this.refresh();
      if (this.polling) setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  }
}

function loadSeen(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set((JSON.parse(raw) as number[]).filter((n) => typeof n === 'number'));
  } catch {
    return new Set();
  }
}

function persistSeen(s: Set<number>): void {
  try {
    // yalnızca son 100 kimliği tut (sınırsız büyümesin)
    const ids = [...s].slice(-100);
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // storage yoksa geç
  }
}
