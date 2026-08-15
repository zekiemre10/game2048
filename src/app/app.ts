import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { Confetti } from './components/confetti/confetti';
import { Tutorial } from './components/tutorial/tutorial';
import { GameView } from './components/game-view/game-view';
import { MissionsPanel } from './components/missions-panel/missions-panel';
import { AchievementsPanel } from './components/achievements-panel/achievements-panel';
import { DailyPanel } from './components/daily-panel/daily-panel';
import { PuzzlePanel } from './components/puzzle-panel/puzzle-panel';
import { LeaderboardPanel } from './components/leaderboard-panel/leaderboard-panel';
import { StorePanel } from './components/store-panel/store-panel';
import { ProfilePanel } from './components/profile-panel/profile-panel';
import { SettingsPanel } from './components/settings-panel/settings-panel';
import { AuthPanel } from './components/auth-panel/auth-panel';
import { ChatPanel } from './components/chat-panel/chat-panel';
import { FriendsPanel } from './components/friends-panel/friends-panel';
import { MultiplayerPanel } from './components/multiplayer-panel/multiplayer-panel';
import { GameService } from './services/game.service';
import { I18nService } from './services/i18n.service';
import { SeoService } from './services/seo.service';
import { PwaService } from './services/pwa.service';
import { AuthService } from './services/auth.service';
import { FriendsService } from './services/friends.service';
import { ChatService } from './services/chat.service';
import { MultiplayerService } from './services/multiplayer.service';
import { LeaderboardService } from './services/leaderboard.service';
import { DailyService } from './services/daily.service';
import { SfxService } from './services/sfx.service';
import { Direction, GameMode, GameStatus } from './models/tile.model';
import { swipeDirection } from './logic/swipe';

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
  imports: [
    StartScreen,
    Confetti,
    Tutorial,
    GameView,
    MissionsPanel,
    AchievementsPanel,
    DailyPanel,
    PuzzlePanel,
    LeaderboardPanel,
    StorePanel,
    ProfilePanel,
    SettingsPanel,
    AuthPanel,
    ChatPanel,
    FriendsPanel,
    MultiplayerPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly game = inject(GameService);
  private readonly sfx = inject(SfxService);
  private readonly i18n = inject(I18nService);
  // SEO/paylaşım meta servisini örnekle (dil değişince başlık/açıklama/OG tazeler).
  private readonly seo = inject(SeoService);
  private readonly pwa = inject(PwaService);
  private readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly chat = inject(ChatService);
  private readonly mp = inject(MultiplayerService);
  private readonly leaderboard = inject(LeaderboardService);
  private readonly daily = inject(DailyService);

  /** Statik metin çevirisi (şablonda anahtarla çağrılır). */
  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  // Ana bileşende kalanlar: Idle/oyun geçişi (gate) + üst çubuk verisi +
  // skor gönderimi/giriş effect'lerinin ihtiyaç duyduğu durumlar. Oyun HUD'u,
  // yan panel ve overlay tamamen components/game-view'e taşındı.
  protected readonly status = this.game.status;
  protected readonly GameStatus = GameStatus;

  // Skor gönderimi effect'leri + klavye/dokunmatik girişi için gereken durumlar.
  private readonly score = this.game.score;
  private readonly moves = this.game.moves;
  private readonly mode = this.game.mode;
  private readonly autoplaying = this.game.autoplaying;
  private readonly paused = this.game.paused;

  // Üst çubuk (profil hapı + aksiyon butonları).
  protected readonly gold = this.game.gold;
  protected readonly currentStreak = this.game.currentStreak;
  protected readonly canClaimDaily = this.game.canClaimDaily;
  protected readonly claimableMissions = this.game.claimableMissions;
  protected readonly avatar = this.game.avatar;

  // --- PWA (çevrimdışı / kurulum / güncelleme) ---------------
  protected readonly online = this.pwa.online;
  protected readonly pwaUpdateReady = this.pwa.updateReady;
  /** "Ana ekrana ekle" gösterilebilir mi (uygun + kapatılmadı). */
  protected readonly pwaInstallable = computed(
    () => this.pwa.installable() && !this.installDismissed(),
  );
  private readonly installDismissed = signal(false);

  onPwaInstall(): void {
    void this.pwa.promptInstall();
  }
  onPwaUpdate(): void {
    void this.pwa.applyUpdate();
  }
  /** Kurulum istemini kapat (ısrarcı olmasın — bu oturumda bir daha gösterme). */
  onPwaDismissInstall(): void {
    this.installDismissed.set(true);
  }

  /** Ayarlar paneli açık mı? */
  protected readonly settingsOpen = signal(false);

  /** Mağaza paneli açık mı? */
  protected readonly storeOpen = signal(false);

  /** Profil paneli açık mı? */
  protected readonly profileOpen = signal(false);

  /** Görevler paneli açık mı? */
  protected readonly missionsOpen = signal(false);

  /** Başarımlar paneli açık mı? (ana ekrandaki şeritten açılır) */
  protected readonly achievementsOpen = signal(false);

  // --- Skor tablosu ------------------------------------------
  protected readonly leaderboardOpen = signal(false);

  onOpenLeaderboard(): void {
    this.closeAllPanels();
    this.leaderboardOpen.set(true);
    void this.leaderboard.load();
  }

  // --- Günlük meydan okuma -----------------------------------
  protected readonly dailyOpen = signal(false);

  onOpenDaily(): void {
    this.closeAllPanels();
    this.dailyOpen.set(true);
    void this.daily.load();
  }

  onCloseDaily(): void {
    this.dailyOpen.set(false);
  }

  // --- Bulmaca modu ------------------------------------------
  protected readonly puzzlesOpen = signal(false);

  onOpenPuzzles(): void {
    this.closeAllPanels();
    this.puzzlesOpen.set(true);
  }

  onClosePuzzles(): void {
    this.puzzlesOpen.set(false);
  }

  /** Aynı oyun sonucunun iki kez gönderilmesini önleyen işaret. */
  private lastSubmitStamp = '';

  // --- Aylık skor bildirimi ----------------------------------
  //
  // Skor SADECE oyun bitince gönderilirse, oyunu yarıda bırakan (ana ekrana
  // dönen / yeni oyun açan) oyuncunun skoru hiç kaydedilmiyordu. Bu yüzden
  // skor yükseldikçe de bildiriyoruz (geciktirmeli, ağı yormadan).

  /** Bu oturumda sunucuya bildirilen en yüksek aylık skor. */
  private monthlySent = 0;
  private monthlyTimer: ReturnType<typeof setTimeout> | null = null;
  private monthlyQueued = false;

  /**
   * Aylık gönderimi geciktirmeli sıraya alır. Skoru İSTEMCİ göndermez —
   * flush anında oyunun tohum+hamle transkripti gönderilir, sunucu skoru
   * kendisi hesaplar. Güç kullanılan oyun HİÇ gönderilmez (sıralamaya girmez).
   */
  private queueMonthly(score: number): void {
    if (this.game.powerUsedThisGame()) return; // güçlü oyun sıralama dışı
    if (score <= this.monthlySent) return;
    this.monthlyQueued = true;
    if (typeof setTimeout === 'undefined') return;
    if (this.monthlyTimer !== null) clearTimeout(this.monthlyTimer);
    this.monthlyTimer = setTimeout(() => this.flushMonthly(), 4000);
  }

  /** Bekleyen aylık transkripti hemen gönderir. */
  private flushMonthly(): void {
    if (this.monthlyTimer !== null) {
      clearTimeout(this.monthlyTimer);
      this.monthlyTimer = null;
    }
    if (!this.monthlyQueued) return;
    this.monthlyQueued = false;
    if (this.game.powerUsedThisGame() || this.game.aiPlayed()) return;
    const score = this.score();
    if (score <= this.monthlySent) return;
    this.monthlySent = score;
    void this.leaderboard.submitMonthly(this.game.gameTranscript(), score);
  }

  onCloseLeaderboard(): void {
    this.leaderboardOpen.set(false);
  }

  onOpenAchievements(): void {
    this.closeAllPanels();
    this.achievementsOpen.set(true);
  }

  onCloseAchievements(): void {
    this.achievementsOpen.set(false);
  }

  // --- Hesap (giriş / kayıt) ---------------------------------
  /** Giriş yapan kullanıcı (null = misafir) — üst çubuk + diğer paneller kullanır. */
  protected readonly authUser = this.auth.user;
  /** Hesap paneli açık mı? (form + gönderim components/auth-panel'de) */
  protected readonly authOpen = signal(false);

  // --- Arkadaşlar --------------------------------------------
  /** Arkadaşlar paneli açık mı? (liste/arama/istekler components/friends-panel'de) */
  protected readonly friendsOpen = signal(false);
  /** Arkadaşlar butonu rozeti (üst çubuk): gelen istek + okunmamış sohbet. */
  protected readonly friendsBadge = computed(
    () => this.friends.incomingCount() + this.chat.totalUnread(),
  );

  // --- Sohbet ------------------------------------------------
  /** Aktif sohbet varsa components/chat-panel gösterilir (gate). */
  protected readonly activeChat = this.chat.activeFriend;

  // --- Çok oyunculu ------------------------------------------
  // Panel (kur/katıl/lobi/bot) + oyun içi yarış sıralaması components/multiplayer-
  // panel ve components/game-view'e taşındı. Burada yalnızca panel gate + üst
  // çubuk noktası (mpRoom) + "racing" olunca paneli kapatan effect kalır.
  protected readonly mpOpen = signal(false);
  protected readonly mpRoom = this.mp.room;
  private readonly mpStatus = this.mp.status;

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

    // Oyun bitince sonucu sunucuya gönder:
    // - Günlük modda günün sıralamasına
    // - Her modda AYLIK skor tablosuna (ay sonunda 1. büyük ödül alır)
    effect(() => {
      const s = this.status();
      const mode = this.mode();
      const over =
        s === GameStatus.Lost ||
        s === GameStatus.Won ||
        s === GameStatus.Failed ||
        s === GameStatus.LevelComplete;
      untracked(() => {
        if (!over) return;
        if (this.game.aiPlayed()) return; // YZ oynadıysa sıralamaya girmez
        const score = this.score();
        if (score <= 0) return;

        // Güç kullanılan oyun sıralamaya girmez (doğrulanamaz + eşit şartlar)
        if (this.game.powerUsedThisGame()) return;

        // Aynı oyun sonunu iki kez göndermeyi engelle
        const stamp = `${mode}|${s}|${score}|${this.moves()}`;
        if (this.lastSubmitStamp === stamp) return;
        this.lastSubmitStamp = stamp;

        this.queueMonthly(score);
        this.flushMonthly(); // oyun bitti → beklemeden gönder

        if (mode === GameMode.Daily) {
          const t = this.game.gameTranscript();
          void this.daily.submit(t.moves, score).then(() => this.daily.load());
        }
      });
    });

    // Oyun DEVAM EDERKEN de skoru aylık tabloya bildir: oyuncu oyunu yarıda
    // bırakıp ana ekrana dönse bile o skor sıralamaya girsin.
    effect(() => {
      const score = this.score();
      untracked(() => {
        if (score <= 0) return;
        if (this.game.aiPlayed()) return; // YZ oynadıysa sayılmaz
        this.queueMonthly(score);
      });
    });

    // Sekme kapanırken/gizlenirken bekleyen skoru kaçırma
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushMonthly();
      });
      window.addEventListener('pagehide', () => this.flushMonthly());
    }

    // Kutlama: başarım/seviye/2048 anında konfeti + ses.
    effect(() => {
      const c = this.game.celebration();
      if (!c) return;
      untracked(() => {
        this.confettiBurst.update((n) => n + 1);
        // Başarım küçük bir "ding", seviye/kazanç tam fanfar.
        if (c.kind === 'achievement') this.sfx.playReward();
        else this.sfx.playFanfare();
      });
    });
  }

  /** Konfeti patlama sayacı (her artışta yeni yağmur). */
  protected readonly confettiBurst = signal(0);

  // --- İlk oyun rehberi --------------------------------------

  /** Rehber açık mı? İlk ziyarette otomatik açılır. */
  protected readonly tutorialOpen = signal(!tutorialSeen());

  /** Rehber kapatıldı → bir daha otomatik açılmasın. */
  onCloseTutorial(): void {
    this.tutorialOpen.set(false);
    saveTutorialSeen();
  }

  /** Ayarlar'dan rehberi yeniden aç. */
  onShowTutorial(): void {
    this.settingsOpen.set(false);
    this.tutorialOpen.set(true);
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
    // Oyun bitince (Won/Lost), başlamadan veya duraklatılmışken giriş alınmaz.
    if (this.status() !== GameStatus.Playing || this.paused()) return;
    // İnsan hamle yaptıysa YZ otomatik oynatmayı devral (durdur).
    if (this.autoplaying()) this.game.stopAutoplay();

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

  // --- Mağaza ------------------------------------------------

  onOpenStore(): void {
    this.closeAllPanels();
    this.storeOpen.set(true);
  }

  onCloseStore(): void {
    this.storeOpen.set(false);
  }

  // --- Profil + günlük ödül ----------------------------------

  onOpenProfile(): void {
    this.closeAllPanels();
    this.profileOpen.set(true);
  }

  onCloseProfile(): void {
    this.profileOpen.set(false);
  }

  // --- Görevler ----------------------------------------------

  onOpenMissions(): void {
    this.closeAllPanels();
    this.missionsOpen.set(true);
  }

  onCloseMissions(): void {
    this.missionsOpen.set(false);
  }

  // --- Hesap (giriş / kayıt) ---------------------------------

  /**
   * Hesap panelini aç (misafirse giriş formu). Form alanları bileşenin kendi
   * signalleridir ve panel her açılışta yeniden kurulduğundan kendiliğinden sıfırlanır.
   */
  onOpenAuth(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.friendsOpen.set(false);
    this.mpOpen.set(false);
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
    // Odadan da çık: yoksa yoklama döngüsü ana ekranda sonsuza dek
    // çalışıp "bitirdi" bilgisi göndermeye devam ediyordu.
    void this.mp.leaveRoom();
    this.flushMonthly(); // yarıda bırakılan oyunun skoru da sıralamaya girsin
    this.game.goHome();
  }

  onCloseAuth(): void {
    this.authOpen.set(false);
  }

  /** Çıkış yap. */
  async onLogout(): Promise<void> {
    // Önceki hesabın izleri kalmasın: açık sohbet, okunmamış rozeti, oda.
    this.chat.close();
    this.chat.clearUnread();
    void this.mp.leaveRoom();
    this.friendsOpen.set(false);
    await this.auth.logout();
    this.friends.refresh(); // listeyi temizle
  }

  /**
   * Hesap kalıcı silindi (Ayarlar'daki "Hesabı sil"). Oturum AuthService'te
   * zaten kapatıldı; burada yalnızca eski hesabın açık izlerini temizleriz.
   */
  onAccountDeleted(): void {
    this.chat.close();
    this.chat.clearUnread();
    void this.mp.leaveRoom();
    this.friendsOpen.set(false);
    this.settingsOpen.set(false);
    this.friends.refresh();
  }

  // --- Arkadaşlar --------------------------------------------

  onOpenFriends(): void {
    this.closeAllPanels();
    this.friends.clearSearch();
    this.friendsOpen.set(true);
    this.friends.refresh();
  }

  onCloseFriends(): void {
    this.friendsOpen.set(false);
  }

  // --- Sohbet ------------------------------------------------

  /** Sohbeti kapat (arka plana tıklama / geri). */
  onCloseChat(): void {
    this.chat.close();
  }

  // --- Çok oyunculu ------------------------------------------

  onOpenMultiplayer(): void {
    this.closeAllPanels();
    this.mpOpen.set(true);
  }

  onCloseMultiplayer(): void {
    this.mpOpen.set(false);
  }

  // --- Ayarlar paneli -----------------------------------------

  /** Ayarlar panelini aç. */
  onOpenSettings(): void {
    this.closeAllPanels();
    this.settingsOpen.set(true);
  }

  /**
   * Tüm üst panelleri kapatır. Paneller aynı arka planı (backdrop)
   * paylaştığından üst üste açıldıklarında iki `aria-modal` iç içe kalıyor
   * ve arka plana tıklamak yalnızca üsttekini kapatıyordu.
   */
  private closeAllPanels(): void {
    this.settingsOpen.set(false);
    this.profileOpen.set(false);
    this.storeOpen.set(false);
    this.missionsOpen.set(false);
    this.friendsOpen.set(false);
    this.mpOpen.set(false);
    this.achievementsOpen.set(false);
    this.leaderboardOpen.set(false);
    this.dailyOpen.set(false);
    this.puzzlesOpen.set(false);
  }

  /** Ayarlar panelini kapat. */
  onCloseSettings(): void {
    this.settingsOpen.set(false);
  }
}

// --- İlk oyun rehberi tercihi (localStorage) -----------------

const TUTORIAL_KEY = 'game2048.tutorialSeen';

function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return true; // depolama yoksa rehberi zorlamayalım
  }
}

function saveTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* yoksay */
  }
}
