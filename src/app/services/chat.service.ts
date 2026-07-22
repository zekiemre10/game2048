import { Injectable, computed, inject, signal } from '@angular/core';
import { API_BASE, AuthService } from './auth.service';
import { Friend } from './friends.service';

// ============================================================
//  2048 — Sohbet servisi
//  Arkadaşlar arası mesajlaşma (emoji destekli).
//  Backend: POST/GET /messages, GET /messages/overview
//  Gerçek zamana yakın: aktif sohbet 3sn, rozetler 8sn'de bir yoklanır.
// ============================================================

export interface ChatMessage {
  id: number;
  from_id: number;
  to_id: number;
  body: string;
  created: number;
}

const SEEN_KEY = 'game2048.chatSeen';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly auth = inject(AuthService);

  /** Açık sohbetin karşı tarafı (yoksa null). */
  readonly activeFriend = signal<Friend | null>(null);
  /** Açık sohbetteki mesajlar. */
  readonly messages = signal<ChatMessage[]>([]);
  /** Gönderiliyor mu? */
  readonly sending = signal(false);

  /** Okunmamış mesajı olan arkadaş kimlikleri. */
  readonly unread = signal<Set<number>>(new Set());
  readonly totalUnread = computed(() => this.unread().size);

  /** Görülen son mesaj kimlikleri: { friendId: lastSeenMsgId }. */
  private seen: Record<number, number> = loadSeen();

  private activePoll = false;
  private overviewPoll = false;

  /** Benim kullanıcı kimliğim (mesaj yönü için). */
  myId(): number | null {
    return this.auth.user()?.id ?? null;
  }

  /** Bir arkadaşla sohbeti aç. */
  async open(friend: Friend): Promise<void> {
    this.activeFriend.set(friend);
    this.messages.set([]);
    await this.loadMessages(true);
    this.markSeen();
    this.startActivePolling();
  }

  close(): void {
    this.activeFriend.set(null);
    this.messages.set([]);
    this.activePoll = false;
    this.pollGen++; // kurulu kalan zamanlayıcıyı geçersiz kıl
  }

  /** Aktif sohbetin mesajlarını çek (fresh=true → baştan). */
  private async loadMessages(fresh = false): Promise<void> {
    const friend = this.activeFriend();
    const headers = this.auth.authHeaders();
    if (!friend || !headers) return;
    const after = fresh ? 0 : lastId(this.messages());
    try {
      const res = await fetch(
        `${API_BASE}/messages?with=${friend.id}&after=${after}`,
        { headers },
      );
      if (!res.ok) return;
      const j = await res.json();
      // Yanıt beklenirken başka bir arkadaşa geçilmiş olabilir: A'nın
      // mesajlarını B'nin penceresine yazma.
      if (this.activeFriend()?.id !== friend.id) return;
      const incoming: ChatMessage[] = j.messages ?? [];
      if (fresh) {
        this.messages.set(incoming);
      } else if (incoming.length) {
        this.messages.update((cur) => mergeMessages(cur, incoming));
      }
      if (incoming.length) this.markSeen();
    } catch {
      /* çevrimdışı — sessiz */
    }
  }

  /** Mesaj gönder. */
  async send(body: string): Promise<boolean> {
    const friend = this.activeFriend();
    const headers = this.auth.authHeaders();
    const text = body.trim();
    if (!friend || !headers || !text) return false;
    this.sending.set(true);
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: friend.id, body: text }),
      });
      if (!res.ok) return false;
      const j = await res.json();
      // Aynı mesaj yoklama yanıtıyla da gelebilir → id'ye göre tekilleştir
      // (yoksa @for track m.id çift anahtar hatası verir ve balon iki kez çizilir).
      if (j.message && this.activeFriend()?.id === friend.id) {
        this.messages.update((cur) =>
          mergeMessages(cur, [j.message as ChatMessage]),
        );
        this.markSeen();
      }
      return true;
    } catch {
      return false;
    } finally {
      this.sending.set(false);
    }
  }

  /** Okunmamış rozetlerini anında temizler (çıkış yapılırken). */
  clearUnread(): void {
    this.unread.set(new Set());
  }

  /** Rozetler için: tüm sohbetlerin son mesajını yokla. */
  async refreshOverview(): Promise<void> {
    const headers = this.auth.authHeaders();
    if (!headers) {
      this.unread.set(new Set());
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/messages/overview`, { headers });
      if (!res.ok) return;
      const j = await res.json();
      const me = this.myId();
      const active = this.activeFriend()?.id;
      const unread = new Set<number>();
      for (const c of j.conversations ?? []) {
        // Son mesajı karşı taraf yazdıysa ve görülmediyse okunmamış say
        const seenId = this.seen[c.other] ?? 0;
        if (c.lastFrom !== me && c.lastId > seenId && c.other !== active) {
          unread.add(c.other);
        }
      }
      this.unread.set(unread);
    } catch {
      /* sessiz */
    }
  }

  /** Aktif sohbetteki en son mesajı görüldü olarak işaretle (kalıcı). */
  private markSeen(): void {
    const friend = this.activeFriend();
    if (!friend) return;
    const max = lastId(this.messages());
    if (max > (this.seen[friend.id] ?? 0)) {
      this.seen[friend.id] = max;
      saveSeen(this.seen);
    }
    // Bu arkadaşı okunmamışlardan çıkar
    if (this.unread().has(friend.id)) {
      const s = new Set(this.unread());
      s.delete(friend.id);
      this.unread.set(s);
    }
  }

  /**
   * Yoklama kuşağı: sohbet kapatılıp 3sn içinde yeniden açılırsa eski
   * zamanlayıcı hâlâ kuruludur. Kuşak eşleşmezse kendini sonlandırır;
   * aksi hâlde her açma/kapamada bir döngü daha birikir (çift mesaj kaynağı).
   */
  private pollGen = 0;

  private startActivePolling(): void {
    if (this.activePoll) return;
    this.activePoll = true;
    const gen = ++this.pollGen;
    const alive = () => this.activePoll && gen === this.pollGen;
    const tick = async () => {
      if (!alive() || !this.activeFriend()) return;
      await this.loadMessages(false);
      if (alive()) setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }

  /** Arka planda okunmamış rozetlerini güncel tut. */
  startPolling(intervalMs = 8000): void {
    if (this.overviewPoll) return;
    this.overviewPoll = true;
    const tick = async () => {
      // Koşulsuz çağrılır: çıkış yapılmışsa refreshOverview okunmamışları
      // temizler. Eskiden başlık koşulu yüzünden rozet takılı kalıyordu.
      await this.refreshOverview();
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  }
}

function lastId(msgs: ChatMessage[]): number {
  return msgs.length ? msgs[msgs.length - 1].id : 0;
}

/**
 * Gelen mesajları listeye id'ye göre TEKİL ve SIRALI ekler.
 * Gönderme yanıtı ile yoklama yanıtı aynı mesajı taşıyabilir; düz ekleme
 * yapılırsa şablondaki `track m.id` çift anahtar hatası verir.
 */
function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const known = new Set(current.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (!fresh.length) return current;
  return [...current, ...fresh].sort((a, b) => a.id - b.id);
}

function loadSeen(): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<number, number>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* yoksay */
  }
}
