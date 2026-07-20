import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { BoardComponent } from './components/board/board';
import { GameService } from './services/game.service';
import { ThemeService } from './services/theme.service';
import { THEMES, themeDef } from './models/theme.model';
import { I18nService, Lang } from './services/i18n.service';
import { AuthService } from './services/auth.service';
import { FriendsService, Friend } from './services/friends.service';
import { ChatService } from './services/chat.service';
import { MultiplayerService } from './services/multiplayer.service';
import { AudioService } from './services/audio.service';
import { SfxService } from './services/sfx.service';
import { Direction, GameMode, GameStatus } from './models/tile.model';
import { swipeDirection } from './logic/swipe';
import { formatTime } from './logic/format-time';
import { POWERS, PowerId } from './models/power.model';
import { ACHIEVEMENTS } from './models/achievement.model';
import { missionDef } from './models/mission.model';

/** Ok tuşu → yön eşlemesi. */
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowLeft: Direction.Left,
  ArrowRight: Direction.Right,
  ArrowUp: Direction.Up,
  ArrowDown: Direction.Down,
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StartScreen, BoardComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly game = inject(GameService);
  private readonly themeService = inject(ThemeService);
  private readonly audio = inject(AudioService);
  private readonly sfx = inject(SfxService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly chat = inject(ChatService);
  private readonly mp = inject(MultiplayerService);

  /** Statik metin çevirisi (şablonda {{ t('key') }}). */
  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  /** Model verisi çevirisi (TR/EN). */
  protected readonly L = (tr: string, en: string) => this.i18n.L(tr, en);
  /** Aktif dil. */
  protected readonly lang = this.i18n.lang;

  /**
   * Görünen oyuncu adı: giriş yapıldıysa KAYIT NICK'İ (değiştirilemez),
   * misafirse dile göre yerelleştirilmiş varsayılan ("Oyuncu"/"Player").
   */
  protected readonly displayName = computed(() => {
    const u = this.authUser();
    if (u) return u.username;
    return this.i18n.L('Oyuncu', 'Player');
  });

  /** Şablonda kullanmak için durumları dışa aç. */
  protected readonly status = this.game.status;
  protected readonly score = this.game.score;
  protected readonly bestScore = this.game.bestScore;
  protected readonly canUndo = this.game.canUndo;
  protected readonly moves = this.game.moves;
  protected readonly elapsedSeconds = this.game.elapsedSeconds;
  protected readonly theme = this.themeService.theme;
  protected readonly musicOn = this.audio.musicOn;
  protected readonly volume = this.audio.volume;
  protected readonly sfxVolume = this.sfx.sfxVolume;
  protected readonly mode = this.game.mode;
  protected readonly level = this.game.level;
  protected readonly levelTarget = this.game.levelTarget;
  protected readonly remainingSeconds = this.game.remainingSeconds;
  protected readonly gold = this.game.gold;
  protected readonly lastReward = this.game.lastReward;
  protected readonly powers = this.game.powers;
  protected readonly bombMode = this.game.bombMode;
  protected readonly hintDirection = this.game.hintDirection;
  protected readonly GameStatus = GameStatus;
  protected readonly GameMode = GameMode;
  protected readonly Direction = Direction;
  protected readonly POWERS = POWERS;
  protected readonly THEMES = THEMES;
  protected readonly ACHIEVEMENTS = ACHIEVEMENTS;

  // Profil / meta
  protected readonly playerName = this.game.playerName;
  protected readonly gamesPlayed = this.game.gamesPlayed;
  protected readonly gamesWon = this.game.gamesWon;
  protected readonly winRate = this.game.winRate;
  protected readonly bestTile = this.game.bestTile;
  protected readonly totalMoves = this.game.totalMoves;
  protected readonly currentStreak = this.game.currentStreak;
  protected readonly bestStreak = this.game.bestStreak;
  protected readonly canClaimDaily = this.game.canClaimDaily;
  protected readonly unlockedAchievements = this.game.unlockedAchievements;
  protected readonly claimableMissions = this.game.claimableMissions;

  /** Günlük görevleri tanımlarıyla birleştirir (UI için). */
  protected readonly dailyView = computed(() =>
    this.game
      .dailyMissions()
      .map((m) => ({ ...m, def: missionDef(m.id)! }))
      .filter((m) => m.def),
  );

  /** Haftalık görevleri tanımlarıyla birleştirir. */
  protected readonly weeklyView = computed(() =>
    this.game
      .weeklyMissions()
      .map((m) => ({ ...m, def: missionDef(m.id)! }))
      .filter((m) => m.def),
  );

  /** Ayarlar paneli açık mı? */
  protected readonly settingsOpen = signal(false);

  /** Mağaza paneli açık mı? */
  protected readonly storeOpen = signal(false);

  /** Aktif mağaza sekmesi. */
  protected readonly storeTab = signal<'themes' | 'powers'>('themes');

  /** Profil paneli açık mı? */
  protected readonly profileOpen = signal(false);

  /** Görevler paneli açık mı? */
  protected readonly missionsOpen = signal(false);

  // --- Hesap (giriş / kayıt) ---------------------------------
  /** Giriş yapan kullanıcı (null = misafir). */
  protected readonly authUser = this.auth.user;
  /** İşlem sürüyor mu? */
  protected readonly authBusy = this.auth.busy;
  /** Hesap paneli açık mı? */
  protected readonly authOpen = signal(false);
  /** Panel modu: giriş mi kayıt mı? */
  protected readonly authTab = signal<'login' | 'register'>('login');
  /** Form alanları. */
  protected readonly authName = signal('');
  protected readonly authEmail = signal('');
  protected readonly authPass = signal('');
  /** Hata mesajı anahtarı (auth.err.*), yoksa ''. */
  protected readonly authError = signal('');

  // --- Arkadaşlar --------------------------------------------
  protected readonly friendsOpen = signal(false);
  protected readonly friendsList = this.friends.friends;
  protected readonly friendsIncoming = this.friends.incoming;
  protected readonly friendsOutgoing = this.friends.outgoing;
  protected readonly incomingCount = this.friends.incomingCount;
  /** Arkadaşlar butonu rozeti: gelen istek + okunmamış sohbet. */
  protected readonly friendsBadge = computed(
    () => this.friends.incomingCount() + this.chat.totalUnread(),
  );
  protected readonly friendSearchResults = this.friends.searchResults;
  protected readonly friendSearching = this.friends.searching;
  protected readonly friendSearchTerm = signal('');
  /** İstek gönderilen kullanıcı adları (butonu "İstendi" yapmak için). */
  protected readonly justRequested = signal<Set<string>>(new Set());

  // --- Sohbet ------------------------------------------------
  protected readonly activeChat = this.chat.activeFriend;
  protected readonly chatMessages = this.chat.messages;
  protected readonly chatSending = this.chat.sending;
  protected readonly chatUnread = this.chat.unread;
  protected readonly totalUnread = this.chat.totalUnread;
  protected readonly chatDraft = signal('');
  /** Sık kullanılan emojiler (basit seçici). */
  protected readonly EMOJIS = [
    '😀', '😄', '😅', '😂', '😉', '😍', '😎', '🤔', '😴', '😢',
    '👍', '👎', '👏', '🙌', '👋', '🔥', '💪', '🎉', '🎮', '🏆',
    '❤️', '💯', '⭐', '✨', '🤝', '😱', '🙃', '😜', '🥳', '👀',
  ];

  // --- Çok oyunculu ------------------------------------------
  protected readonly mpOpen = signal(false);
  protected readonly mpRoom = this.mp.room;
  protected readonly mpStatus = this.mp.status;
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

  /** Envanterde en az 1 tane olan güçler (oyun içi güç çubuğu için). */
  protected readonly ownedPowers = computed(() =>
    POWERS.filter((p) => this.powers()[p.id] > 0),
  );

  /** Geçen süreyi mm:ss biçiminde döndürür (şablonda gösterim için). */
  protected readonly elapsedLabel = computed(() => formatTime(this.elapsedSeconds()));

  /** Kalan süreyi mm:ss biçiminde döndürür (seviye modu). */
  protected readonly remainingLabel = computed(() =>
    formatTime(this.remainingSeconds()),
  );

  /** Kalan süre azaldı mı? (geri sayımlı modlarda görsel uyarı). */
  protected readonly lowTime = computed(
    () =>
      (this.mode() === GameMode.Level ||
        this.mode() === GameMode.TimeAttack ||
        this.mode() === GameMode.Race) &&
      this.remainingSeconds() <= 10,
  );

  /** Ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly volumePercent = computed(() => Math.round(this.volume() * 100));

  /** Efekt ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly sfxPercent = computed(() => Math.round(this.sfxVolume() * 100));

  constructor() {
    // Giriş varken arkadaş listesi + gelen istek rozetini güncel tut.
    this.friends.refresh();
    this.friends.startPolling();
    // Okunmamış sohbet rozetlerini arka planda yokla.
    this.chat.refreshOverview();
    this.chat.startPolling();

    // Yarış başlayınca çok oyunculu paneli kapat → oyuncu tahtayı görsün.
    effect(() => {
      if (this.mpStatus() === 'racing') this.mpOpen.set(false);
    });
  }

  /** Dokunmatik kaydırmanın başlangıç noktası. */
  private touchStartX = 0;
  private touchStartY = 0;

  // --- Klavye -------------------------------------------------

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const direction = KEY_TO_DIRECTION[event.key];
    if (!direction) return;
    event.preventDefault();
    this.tryMove(direction);
  }

  // --- Dokunmatik (mobil) -------------------------------------

  @HostListener('window:touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  }

  @HostListener('window:touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;

    const direction = swipeDirection(dx, dy);
    if (direction) {
      this.tryMove(direction);
    }
  }

  // --- Ortak giriş noktası ------------------------------------

  /** Girişleri tek noktadan hamleye çevirir (kilit kontrolü + ses efekti). */
  private tryMove(direction: Direction): void {
    // Oyun bitince (Won/Lost) veya başlamadan giriş alınmaz.
    if (this.status() !== GameStatus.Playing) return;

    const scoreBefore = this.score();
    const moved = this.game.move(direction);
    if (!moved) return; // geçersiz hamle → ses yok

    // Skor arttıysa birleşme olmuştur → merge sesi, yoksa hamle sesi.
    if (this.score() > scoreBefore) {
      this.sfx.playMerge();
    } else {
      this.sfx.playMove();
    }
  }

  /** Yeni oyun / yeniden başlat (mevcut mod + boyut). */
  onRestart(): void {
    this.game.restartCurrent();
  }

  /** Kazandıktan sonra oyuna devam et. */
  onContinue(): void {
    this.game.continueAfterWin();
  }

  /** Son hamleyi geri al. */
  onUndo(): void {
    this.game.undo();
  }

  // --- Seviye modu -------------------------------------------

  /** Seviye modunu başlat (başlık ekranından değil, overlay'den "Baştan"). */
  onStartLevelMode(): void {
    this.game.startLevelMode();
  }

  /** Sonraki seviyeye geç. */
  onNextLevel(): void {
    this.game.nextLevel();
  }

  /** Başarısız seviyeyi tekrar dene. */
  onRetryLevel(): void {
    this.game.retryLevel();
  }

  // --- Mağaza + güçler ---------------------------------------

  onOpenStore(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(true);
  }

  /** Mağaza sekmesini değiştir. */
  setStoreTab(tab: 'themes' | 'powers'): void {
    this.storeTab.set(tab);
  }

  /** Tema kartı için renkli gradyan (önizleme). */
  protected themeGradient(swatch: [string, string, string]): string {
    return `linear-gradient(135deg, ${swatch[1]}, ${swatch[2]})`;
  }

  onCloseStore(): void {
    this.storeOpen.set(false);
  }

  /** Bir gücü satın al (yeterli altın varsa). */
  onBuyPower(id: PowerId): void {
    this.game.buyPower(id);
  }

  /** Sahip olunan gücü kullan. */
  onUsePower(id: PowerId): void {
    this.game.usePower(id);
  }

  /** Bomba hedeflemeyi iptal et. */
  onCancelBomb(): void {
    this.game.cancelBomb();
  }

  /** Bir güce yetecek altın var mı? */
  protected canAfford(id: PowerId): boolean {
    const price = POWERS.find((p) => p.id === id)!.price;
    return this.gold() >= price;
  }

  // --- Profil + günlük ödül ----------------------------------

  onOpenProfile(): void {
    this.settingsOpen.set(false);
    this.storeOpen.set(false);
    this.profileOpen.set(true);
  }

  onCloseProfile(): void {
    this.profileOpen.set(false);
  }

  /** Günlük ödülü al. */
  onClaimDaily(): void {
    this.game.claimDailyReward();
  }

  /** Başarım açık mı? */
  protected isAchievementUnlocked(id: string): boolean {
    return this.unlockedAchievements().has(id);
  }

  // --- Görevler ----------------------------------------------

  onOpenMissions(): void {
    this.settingsOpen.set(false);
    this.storeOpen.set(false);
    this.profileOpen.set(false);
    this.missionsOpen.set(true);
  }

  onCloseMissions(): void {
    this.missionsOpen.set(false);
  }

  onClaimMission(id: string, type: 'daily' | 'weekly'): void {
    this.game.claimMission(id, type);
  }

  // --- Hesap (giriş / kayıt) ---------------------------------

  /** Hesap panelini aç (misafirse giriş formu). */
  onOpenAuth(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.authError.set('');
    this.authName.set('');
    this.authEmail.set('');
    this.authPass.set('');
    this.authTab.set('login');
    this.authOpen.set(true);
  }

  /** Ana ekrana (başlık / mod seçimi) dön. */
  onGoHome(): void {
    this.authOpen.set(false);
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.friendsOpen.set(false);
    this.mpOpen.set(false);
    this.chat.close();
    this.game.goHome();
  }

  onCloseAuth(): void {
    this.authOpen.set(false);
  }

  /** Giriş/kayıt sekmesini değiştir. */
  setAuthTab(tab: 'login' | 'register'): void {
    this.authTab.set(tab);
    this.authError.set('');
  }

  onAuthNameInput(event: Event): void {
    this.authName.set((event.target as HTMLInputElement).value);
  }

  onAuthEmailInput(event: Event): void {
    this.authEmail.set((event.target as HTMLInputElement).value);
  }

  onAuthPassInput(event: Event): void {
    this.authPass.set((event.target as HTMLInputElement).value);
  }

  /** Formu gönder (moda göre giriş ya da kayıt). */
  async onAuthSubmit(): Promise<void> {
    if (this.authBusy()) return;
    this.authError.set('');
    const name = this.authName().trim();
    const pass = this.authPass();
    const result =
      this.authTab() === 'register'
        ? await this.auth.register(name, pass, this.authEmail().trim())
        : await this.auth.login(name, pass);
    if (result.ok) {
      this.authPass.set('');
      this.authEmail.set('');
      this.authOpen.set(false);
    } else {
      this.authError.set(`auth.err.${result.error}`);
    }
  }

  /** Çıkış yap. */
  async onLogout(): Promise<void> {
    await this.auth.logout();
    this.friends.refresh(); // listeyi temizle
  }

  // --- Arkadaşlar --------------------------------------------

  onOpenFriends(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.friendSearchTerm.set('');
    this.friends.clearSearch();
    this.friendsOpen.set(true);
    this.friends.refresh();
  }

  onCloseFriends(): void {
    this.friendsOpen.set(false);
  }

  /** Hesap panelini arkadaşlar panelinden aç (giriş yoksa). */
  onFriendsLogin(): void {
    this.friendsOpen.set(false);
    this.onOpenAuth();
  }

  /** Arama kutusu değişti. */
  onFriendSearch(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.friendSearchTerm.set(q);
    this.friends.search(q);
  }

  /** Bir kullanıcıya istek gönder. */
  async onAddFriend(username: string): Promise<void> {
    const r = await this.friends.requestFriend({ username });
    if (r.ok) {
      const set = new Set(this.justRequested());
      set.add(username.toLowerCase());
      this.justRequested.set(set);
    }
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

  /** Bu arkadaşta okunmamış mesaj var mı? */
  protected hasUnread(friendId: number): boolean {
    return this.chatUnread().has(friendId);
  }

  // --- Sohbet ------------------------------------------------

  /** Bir arkadaşla sohbeti aç. */
  async onOpenChat(friend: Friend): Promise<void> {
    this.chatDraft.set('');
    await this.chat.open(friend);
  }

  /** Sohbeti kapat (arkadaş listesine dön). */
  onCloseChat(): void {
    this.chat.close();
  }

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

  // --- Çok oyunculu ------------------------------------------

  onOpenMultiplayer(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.friendsOpen.set(false);
    this.mpError.set('');
    this.mpJoinCode.set('');
    this.mpOpen.set(true);
  }

  onCloseMultiplayer(): void {
    this.mpOpen.set(false);
  }

  /** Hesap panelini çok oyunculudan aç (giriş yoksa). */
  onMpLogin(): void {
    this.mpOpen.set(false);
    this.onOpenAuth();
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

  /** Bir oyuncu ben miyim? */
  protected isMe(playerId: number): boolean {
    return playerId === this.authUser()?.id;
  }

  // --- Ayarlar paneli -----------------------------------------

  /** Ayarlar panelini aç. */
  onOpenSettings(): void {
    this.settingsOpen.set(true);
  }

  /** Ayarlar panelini kapat. */
  onCloseSettings(): void {
    this.settingsOpen.set(false);
  }

  /** Temayı seç (sahip olunanlar arasından). */
  onSelectTheme(id: string): void {
    this.themeService.select(id);
  }

  /** Temayı mağazadan satın al. */
  onBuyTheme(id: string): void {
    this.themeService.buyTheme(id);
  }

  /** Bir tema sahip olunuyor mu? */
  protected isThemeOwned(id: string): boolean {
    return this.themeService.isOwned(id);
  }

  /** Dili ayarla. */
  onSetLang(lang: Lang): void {
    this.i18n.set(lang);
  }

  /** Müziği aç/kapat. */
  onToggleMusic(): void {
    this.audio.toggleMusic();
  }

  /** Müzik ses seviyesi kaydırıcısı değişti (0-100 → 0..1). */
  onVolumeInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.audio.setVolume(value / 100);
  }

  /** Efekt ses seviyesi kaydırıcısı değişti (0-100 → 0..1). */
  onSfxInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.sfx.setVolume(value / 100);
    this.sfx.playMove(); // anlık önizleme: kaydırınca duyulsun
  }
}
