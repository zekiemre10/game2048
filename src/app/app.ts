import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { StartScreen } from './components/start-screen/start-screen';
import { BoardComponent } from './components/board/board';
import { GameService } from './services/game.service';
import { ThemeService, Theme } from './services/theme.service';
import { AudioService } from './services/audio.service';
import { SfxService } from './services/sfx.service';
import { Direction, GameMode, GameStatus } from './models/tile.model';
import { swipeDirection } from './logic/swipe';
import { formatTime } from './logic/format-time';

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
  protected readonly GameStatus = GameStatus;
  protected readonly GameMode = GameMode;

  /** Ayarlar paneli açık mı? */
  protected readonly settingsOpen = signal(false);

  /** Geçen süreyi mm:ss biçiminde döndürür (şablonda gösterim için). */
  protected readonly elapsedLabel = computed(() => formatTime(this.elapsedSeconds()));

  /** Kalan süreyi mm:ss biçiminde döndürür (seviye modu). */
  protected readonly remainingLabel = computed(() =>
    formatTime(this.remainingSeconds()),
  );

  /** Kalan süre azaldı mı? (görsel uyarı için). */
  protected readonly lowTime = computed(
    () => this.mode() === GameMode.Level && this.remainingSeconds() <= 10,
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

  /** Yeni oyun / yeniden başlat. */
  onRestart(): void {
    this.game.startGame();
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

  // --- Ayarlar paneli -----------------------------------------

  /** Ayarlar panelini aç. */
  onOpenSettings(): void {
    this.settingsOpen.set(true);
  }

  /** Ayarlar panelini kapat. */
  onCloseSettings(): void {
    this.settingsOpen.set(false);
  }

  /** Temayı doğrudan ayarla (Ayarlar panelindeki düğmeler). */
  onSetTheme(theme: Theme): void {
    this.themeService.set(theme);
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
