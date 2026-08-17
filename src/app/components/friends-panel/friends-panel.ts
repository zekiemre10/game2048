import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { FriendsService, Friend } from '../../services/friends.service';
import { ChatService } from '../../services/chat.service';

/**
 * Arkadaşlar paneli (arama + istekler + arkadaş listesi + sohbet açma).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close`, giriş çağrısı
 * `openAuth` ile bildirilir. Sohbet açmayı ChatService doğrudan tetikler.
 */
@Component({
  selector: 'app-friends-panel',
  standalone: true,
  templateUrl: './friends-panel.html',
  styleUrl: './friends-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendsPanel {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly chat = inject(ChatService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Giriş gerektiğinde ana bileşen hesap panelini açar. */
  readonly openAuth = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly authUser = this.auth.user;
  protected readonly friendsList = this.friends.friends;
  protected readonly friendsIncoming = this.friends.incoming;
  protected readonly friendsOutgoing = this.friends.outgoing;
  protected readonly friendSearchResults = this.friends.searchResults;
  protected readonly friendSearching = this.friends.searching;
  private readonly chatUnread = this.chat.unread;

  protected readonly friendSearchTerm = signal('');
  /** İstek gönderilen kullanıcı adları (butonu "İstendi" yapmak için). */
  protected readonly justRequested = signal<Set<string>>(new Set());
  /** Arkadaş ekleme hatası (çeviri anahtarı) — boşsa hata yok. */
  protected readonly friendError = signal('');

  /** Hesap panelini arkadaşlar panelinden aç (giriş yoksa). */
  onFriendsLogin(): void {
    this.openAuth.emit();
  }

  /** Arama kutusu değişti. */
  onFriendSearch(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.friendSearchTerm.set(q);
    this.friendError.set(''); // yeni arama → eski hata mesajını temizle
    this.friends.search(q);
  }

  /** Bir kullanıcıya istek gönder. */
  async onAddFriend(username: string): Promise<void> {
    this.friendError.set('');
    const r = await this.friends.requestFriend({ username });
    if (r.ok) {
      const set = new Set(this.justRequested());
      set.add(username.toLowerCase());
      this.justRequested.set(set);
      return;
    }
    // Hata artık sessizce yutulmuyor: kullanıcı neden olmadığını görsün.
    this.friendError.set(`fr.err.${r.error || 'error'}`);
  }

  /** Bir kullanıcıya zaten istek gönderildi mi (bu oturumda)? */
  protected isRequested(username: string): boolean {
    return this.justRequested().has(username.toLowerCase());
  }

  /** Gelen isteği kabul et / reddet. */
  async onRespondFriend(reqId: number, accept: boolean): Promise<void> {
    await this.friends.respond(reqId, accept);
  }

  /** Arkadaşlıktan çıkar. */
  async onRemoveFriend(userId: number): Promise<void> {
    await this.friends.remove(userId);
  }

  /** Kullanıcıyı engelle (onaylı) — mesaj/istek kesilir, arkadaşlık kalkar. */
  async onBlockFriend(friend: Friend): Promise<void> {
    if (!confirm(this.t('mod.block.confirm', { user: friend.username }))) return;
    await this.friends.block(friend.id);
  }

  /** Bu arkadaşta okunmamış mesaj var mı? */
  protected hasUnread(friendId: number): boolean {
    return this.chatUnread().has(friendId);
  }

  /** Bir arkadaşla sohbeti aç (sohbet penceresi ana bileşende görünür). */
  async onOpenChat(friend: Friend): Promise<void> {
    await this.chat.open(friend);
  }
}
