import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { MultiplayerService, RoomPlayer } from '../../services/multiplayer.service';
import { isAiLevel } from '../../logic/ai';

/**
 * Çok oyunculu paneli (oda kur/katıl, lobi, bot ekleme, canlı sıralama).
 * Monolit app bileşeninden ayrıştırıldı: kendi şablonu + stili + mantığı.
 * Açık/kapalı durumunu ana bileşen yönetir; kapatma `close`, giriş çağrısı
 * `openAuth` ile bildirilir. (Yarış başlayınca ana bileşen paneli kapatır.)
 */
@Component({
  selector: 'app-multiplayer-panel',
  standalone: true,
  templateUrl: './multiplayer-panel.html',
  styleUrl: './multiplayer-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiplayerPanel {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly mp = inject(MultiplayerService);

  /** Panel kapatıldığında bildirilir. */
  readonly close = output<void>();
  /** Giriş gerektiğinde ana bileşen hesap panelini açar. */
  readonly openAuth = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly authUser = this.auth.user;
  protected readonly mpRoom = this.mp.room;
  protected readonly mpIsHost = this.mp.isHost;
  protected readonly mpPlayers = this.mp.players;
  protected readonly mpBusy = this.mp.busy;
  protected readonly mpNotice = this.mp.notice;
  protected readonly mpJoinCode = signal('');
  protected readonly mpDuration = signal(180);
  protected readonly mpError = signal('');
  protected readonly mpCopied = signal(false);

  /** Yarış bittiyse kazanan (en yüksek skor). */
  protected readonly mpWinner = computed(() => {
    const p = this.mpPlayers();
    return p.length ? p[0] : null;
  });

  /**
   * Oyuncunun görünen adı. Botlarda ad, seviyeden ve AKTİF DİLDEN üretilir
   * (sunum ayrıntısı; iş mantığı `p.level` verisine bakar, isme değil). Böylece
   * dil değişince bot adı da güncellenir. Seviye verisi yoksa sunucu adına düşer.
   */
  protected mpPlayerName(p: RoomPlayer): string {
    if (p.isBot && isAiLevel(p.level)) {
      const key = 'mp.bot' + p.level[0].toUpperCase() + p.level.slice(1);
      return `🤖 Bot (${this.t(key)})`;
    }
    return p.username;
  }

  /** Bir oyuncu ben miyim? */
  protected isMe(playerId: number): boolean {
    return playerId === this.authUser()?.id;
  }

  /** Hesap panelini çok oyunculudan aç (giriş yoksa). */
  onMpLogin(): void {
    this.openAuth.emit();
  }

  setMpDuration(seconds: number): void {
    this.mpDuration.set(seconds);
  }

  async onCreateRoom(): Promise<void> {
    this.mpError.set('');
    const r = await this.mp.createRoom(this.mpDuration());
    if (!r.ok) this.mpError.set(`mp.err.${r.error}`);
  }

  onMpCodeInput(event: Event): void {
    this.mpJoinCode.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  async onJoinRoom(): Promise<void> {
    this.mpError.set('');
    const code = this.mpJoinCode().trim();
    if (code.length < 4) return;
    const r = await this.mp.joinRoom(code);
    if (!r.ok) this.mpError.set(`mp.err.${r.error}`);
  }

  async onStartRace(): Promise<void> {
    this.mpError.set('');
    const r = await this.mp.startRace();
    if (!r.ok) this.mpError.set(`mp.err.${r.error}`);
  }

  /** Odaya YZ botu ekle (host). */
  async onAddBot(difficulty: 'easy' | 'medium' | 'hard' | 'expert'): Promise<void> {
    this.mpError.set('');
    const r = await this.mp.addBot(difficulty);
    if (!r.ok) this.mpError.set(`mp.err.${r.error}`);
  }

  /** Botu çıkar (host). */
  async onRemoveBot(botId: number): Promise<void> {
    await this.mp.removeBot(botId);
  }

  async onLeaveRoom(): Promise<void> {
    await this.mp.leaveRoom();
    this.mpError.set('');
  }

  /** Oda kodunu panoya kopyala. */
  async onCopyCode(): Promise<void> {
    const code = this.mpRoom()?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.mpCopied.set(true);
      setTimeout(() => this.mpCopied.set(false), 1500);
    } catch {
      /* pano yoksa yoksay */
    }
  }
}
