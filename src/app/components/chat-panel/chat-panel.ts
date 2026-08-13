import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { ChatService } from '../../services/chat.service';

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

  /** Panel kapatıldığında (geri / arka plana tıklama) bildirilir. */
  readonly close = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly activeChat = this.chat.activeFriend;
  protected readonly chatMessages = this.chat.messages;
  protected readonly chatSending = this.chat.sending;
  protected readonly chatDraft = signal('');

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

  /** Bir mesaj bana mı ait? */
  protected isMine(msg: { from_id: number }): boolean {
    return msg.from_id === this.chat.myId();
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
