import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { BoardComponent } from './components/board/board';
import { GameService } from './services/game.service';
import { ThemeService } from './services/theme.service';
import { THEMES, themeDef } from './models/theme.model';
import { I18nService, Lang } from './services/i18n.service';
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

  /** Statik metin çevirisi (şablonda {{ t('key') }}). */
  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);
  /** Model verisi çevirisi (TR/EN). */
  protected readonly L = (tr: string, en: string) => this.i18n.L(tr, en);
  /** Aktif dil. */
  protected readonly lang = this.i18n.lang;

  /** Görünen oyuncu adı (varsayılan ise dile göre yerelleştirilir). */
  protected readonly displayName = computed(() => {
    const n = this.game.playerName();
    return n === 'Oyuncu' || n === 'Player' ? this.i18n.L('Oyuncu', 'Player') : n;
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
  protected readonly storeTab = signal<'themes' | 'powers' | 'achievements'>(
    'themes',
  );

  /** Profil paneli açık mı? */
  protected readonly profileOpen = signal(false);

  /** Görevler paneli açık mı? */
  protected readonly missionsOpen = signal(false);

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
        this.mode() === GameMode.TimeAttack) &&
      this.remainingSeconds() <= 10,
  );

  /** Ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly volumePercent = computed(() => Math.round(this.volume() * 100));

  /** Efekt ses seviyesini yüzde (0-100) olarak gösterir. */
  protected readonly sfxPercent = computed(() => Math.round(this.sfxVolume() * 100));

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
  setStoreTab(tab: 'themes' | 'powers' | 'achievements'): void {
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

  /** Oyuncu adını güncelle (input değişince). */
  onNameInput(event: Event): void {
    this.game.setName((event.target as HTMLInputElement).value);
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
