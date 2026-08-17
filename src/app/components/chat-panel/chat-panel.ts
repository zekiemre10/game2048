import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { ChatService } from '../../services/chat.service';
import { FriendsService } from '../../services/friends.service';

/** Şikayet sebepleri (i18n anahtarları `mod.reason.*`). */
type ReportReason = 'spam' | 'harassment' | 'hate' | 'inappropriate' | 'other';

/**
 * Sohbet paneli (bir arkadaşla mesajlaşma + emoji şeridi).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Aktif sohbeti ChatService yönetir; kapatma `close` ile ana bileşene bildirilir
 * (ana bileşen `activeChat()` doğruyken bu bileşeni gösterir).
 */
@Component({
  selector: 'app-chat-panel',
  standalone: true,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPanel {
  private readonly i18n = inject(I18nService);
  private readonly chat = inject(ChatService);
  private readonly friends = inject(FriendsService);

  /** Panel kapatıldığında (geri / arka plana tıklama) bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly activeChat = this.chat.activeFriend;
  protected readonly chatMessages = this.chat.messages;
  protected readonly chatSending = this.chat.sending;
  protected readonly chatSendError = this.chat.sendError;
  protected readonly chatDraft = signal('');

  /** Gönderim hatasını kullanıcıya açıklayan i18n anahtarı (moderasyon sebepleri dahil). */
  protected sendErrorText(): string {
    const code = this.chatSendError();
    if (!code) return '';
    const known = ['muted', 'blocked', 'banned', 'suspended', 'not_friends'];
    return this.t(known.includes(code) ? `mod.send.${code}` : 'mod.send.error');
  }

  /** Sık kullanılan emojiler (basit seçici). */
  protected readonly EMOJIS = [
    '😀',
    '😄',
    '😅',
    '😂',
    '😉',
    '😍',
    '😎',
    '🤔',
    '😴',
    '😢',
    '👍',
    '👎',
    '👏',
    '🙌',
    '👋',
    '🔥',
    '💪',
    '🎉',
    '🎮',
    '🏆',
    '❤️',
    '💯',
    '⭐',
    '✨',
    '🤝',
    '😱',
    '🙃',
    '😜',
    '🥳',
    '👀',
  ];

  /** Seçilebilir şikayet sebepleri (sıra = gösterim sırası). */
  protected readonly REASONS: ReportReason[] = [
    'spam',
    'harassment',
    'hate',
    'inappropriate',
    'other',
  ];

  // --- Moderasyon durumu (engelle / şikayet akışı) ---
  /** Şikayet penceresi açık mı: hedef mesaj id'si, kullanıcı için 'user', kapalı için null. */
  protected readonly reportFor = signal<number | 'user' | null>(null);
  protected readonly reportReason = signal<ReportReason>('spam');
  protected readonly reportDetail = signal('');
  protected readonly reportBusy = signal(false);
  /** İşlem sonucu bilgisi: 'reported' | 'blocked' | hata anahtarı | null. */
  protected readonly modInfo = signal<string | null>(null);
  protected readonly blockBusy = signal(false);

  /** Bir mesaj bana mı ait? */
  protected isMine(msg: { from_id: number }): boolean {
    return msg.from_id === this.chat.myId();
  }

  /** Şikayet penceresini aç (belirli bir mesaj için ya da kullanıcının geneli için). */
  openReport(target: number | 'user'): void {
    this.reportFor.set(target);
    this.reportReason.set('spam');
    this.reportDetail.set('');
    this.modInfo.set(null);
  }

  closeReport(): void {
    this.reportFor.set(null);
  }

  onReasonChange(event: Event): void {
    this.reportReason.set((event.target as HTMLSelectElement).value as ReportReason);
  }

  onDetailInput(event: Event): void {
    this.reportDetail.set((event.target as HTMLTextAreaElement).value);
  }

  /** Şikayeti gönder. */
  async submitReport(): Promise<void> {
    const friend = this.activeChat();
    const target = this.reportFor();
    if (!friend || target === null || this.reportBusy()) return;
    this.reportBusy.set(true);
    const msgId = target === 'user' ? undefined : target;
    const r = await this.friends.report(
      friend.id,
      this.reportReason(),
      this.reportDetail().trim(),
      msgId,
    );
    this.reportBusy.set(false);
    if (r.ok) {
      this.reportFor.set(null);
      this.modInfo.set('reported');
    } else {
      this.modInfo.set('report_error');
    }
  }

  /** Bu kişiyi engelle (onaylı). Engelleme sohbeti de kapatır. */
  async onBlock(): Promise<void> {
    const friend = this.activeChat();
    if (!friend || this.blockBusy()) return;
    if (!confirm(this.t('mod.block.confirm', { user: friend.username }))) return;
    this.blockBusy.set(true);
    const r = await this.friends.block(friend.id);
    this.blockBusy.set(false);
    if (r.ok) this.close.emit();
    else this.modInfo.set('block_error');
  }

  onChatInput(event: Event): void {
    this.chatDraft.set((event.target as HTMLInputElement).value);
  }

  /** Emoji ekle (imleç sonu). */
  onAddEmoji(emoji: string): void {
    this.chatDraft.update((d) => d + emoji);
  }

  /** Mesajı gönder. */
  async onSendChat(): Promise<void> {
    const text = this.chatDraft();
    if (!text.trim() || this.chatSending()) return;
    const ok = await this.chat.send(text);
    if (ok) this.chatDraft.set('');
  }
}
