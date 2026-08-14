import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { BoardComponent } from '../board/board';
import { MoveTimeline } from '../move-timeline/move-timeline';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { AiService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';
import { MultiplayerService, RoomPlayer } from '../../services/multiplayer.service';
import { BOT_CHARACTERS, isAiLevel, isBotCharacter } from '../../logic/ai';
import { Direction, GameMode, GameStatus } from '../../models/tile.model';
import { formatTime } from '../../logic/format-time';
import { POWERS, PowerId } from '../../models/power.model';

/**
 * Oyun görünümü (üst skor çubuğu + yan panel + tahta + oyun-sonu overlay).
 * Monolit app bileşeninden ayrıştırıldı: status() Idle değilken ana bileşen
 * bunu gösterir. Klavye/dokunmatik girişi ana bileşende (window dinleyicileri)
 * kalır. Ana ekrana dönüş `goHome`, çok oyunculu lobisine dönüş `openMultiplayer`
 * ile bildirilir.
 */
@Component({
  selector: 'app-game-view',
  standalone: true,
  imports: [BoardComponent, MoveTimeline],
  templateUrl: './game-view.html',
  styleUrl: './game-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameView {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);
  private readonly ai = inject(AiService);
  private readonly auth = inject(AuthService);
  private readonly mp = inject(MultiplayerService);

  /** Ana ekrana (başlık / mod seçimi) dön. */
  readonly goHome = output<void>();
  /** Yarış bitti → çok oyunculu panele dön. */
  readonly openMultiplayer = output<void>();

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  // --- Oyun durumu (şablona açılır) --------------------------
  protected readonly status = this.game.status;
  protected readonly score = this.game.score;
  protected readonly bestScore = this.game.bestScore;
  protected readonly gold = this.game.gold;
  protected readonly mode = this.game.mode;
  protected readonly level = this.game.level;
  protected readonly levelTarget = this.game.levelTarget;
  protected readonly remainingSeconds = this.game.remainingSeconds;
  protected readonly elapsedSeconds = this.game.elapsedSeconds;
  protected readonly moves = this.game.moves;
  protected readonly bombMode = this.game.bombMode;
  protected readonly powers = this.game.powers;
  protected readonly canUndo = this.game.canUndo;
  protected readonly autoplaying = this.game.autoplaying;
  protected readonly aiDemoResult = this.game.aiDemoResult;
  protected readonly paused = this.game.paused;
  protected readonly hintDirection = this.game.hintDirection;
  protected readonly lastReward = this.game.lastReward;

  // --- YZ Asistanı -------------------------------------------
  protected readonly assistantOn = this.game.assistantOn;
  protected readonly lastMoveReview = this.game.lastMoveReview;
  protected readonly accuracy = this.game.accuracy;
  protected readonly ratedMoves = this.game.ratedMoves;
  protected readonly moveRatings = this.game.moveRatings;
  protected readonly health = this.game.health;
  protected readonly assistantSuggestion = this.game.assistHintDir;
  protected readonly assistHintsLeft = this.game.assistHintsLeft;
  protected readonly assistHintQuota = GameService.ASSIST_HINT_QUOTA;

  // --- Çok oyunculu (oyun içi yarış sıralaması) --------------
  protected readonly mpRoom = this.mp.room;
  protected readonly mpPlayers = this.mp.players;

  protected readonly GameStatus = GameStatus;
  protected readonly GameMode = GameMode;
  protected readonly Direction = Direction;

  /** Oyun sonu YZ (algoritmik) değerlendirme metni. */
  protected readonly analysisText = signal('');

  // --- Bulmaca modu ------------------------------------------
  /** App'in bulmaca seçim panelini açması için (overlay "Bulmacalara dön"). */
  readonly openPuzzles = output<void>();

  protected readonly currentPuzzle = this.game.currentPuzzle;

  /** Bulmaca hedefinin metni (tür + hedef + bütçe). */
  protected puzzleGoal(): string {
    const p = this.currentPuzzle();
    return p ? this.t('puzzle.goal.' + p.type, { n: p.moveBudget, t: p.target }) : '';
  }

  /** Kalan hamle (bütçe − yapılan). */
  protected readonly puzzleMovesLeft = computed(() => {
    const p = this.currentPuzzle();
    return p ? Math.max(0, p.moveBudget - this.moves()) : 0;
  });

  /** Bulmaca çözüldü mü asgari hamlede (mükemmel)? */
  protected readonly puzzlePerfect = computed(() => {
    const p = this.currentPuzzle();
    return !!p && this.status() === GameStatus.Won && this.moves() <= p.minMoves;
  });

  /** Bulmaca ipucu iste (hedefe götüren ilk hamleyi göster). */
  onPuzzleHint(): void {
    this.game.requestPuzzleHint();
  }

  /** Kişisel LLM koç metni (istek üzerine yüklenir; yeni oyunda temizlenir). */
  protected readonly coachText = signal('');

  /** Koç metni LLM üretimi mi (true) yoksa şablona mı düşüldü (false)? */
  protected readonly coachIsAi = signal(false);

  /** Koç isteği sürüyor mu (buton durumu). */
  protected readonly coachLoading = signal(false);

  /**
   * Kişisel koç butonu görünsün mü? Yalnızca giriş yapmış oyuncuya, oyun bitince
   * (yarış hariç). Misafirler yalnızca şablon analizi görür (maliyet kontrolü:
   * kullanıcı-başına günlük sınır ancak hesapla uygulanabilir).
   */
  protected readonly canCoach = computed(
    () =>
      this.auth.isLoggedIn() &&
      this.mode() !== GameMode.Race &&
      this.mode() !== GameMode.Puzzle &&
      (this.status() === GameStatus.Won ||
        this.status() === GameStatus.Lost ||
        this.status() === GameStatus.Failed ||
        this.status() === GameStatus.LevelComplete),
  );

  /** Envanterde en az 1 tane olan güçler (oyun içi güç çubuğu için). */
  protected readonly ownedPowers = computed(() => POWERS.filter((p) => this.powers()[p.id] > 0));

  /** Geçen süreyi mm:ss biçiminde döndürür. */
  protected readonly elapsedLabel = computed(() => formatTime(this.elapsedSeconds()));

  /** Kalan süreyi mm:ss biçiminde döndürür (seviye modu). */
  protected readonly remainingLabel = computed(() => formatTime(this.remainingSeconds()));

  /** Kalan süre azaldı mı? (geri sayımlı modlarda görsel uyarı). */
  protected readonly lowTime = computed(
    () =>
      (this.mode() === GameMode.Level ||
        this.mode() === GameMode.TimeAttack ||
        this.mode() === GameMode.Race) &&
      this.remainingSeconds() <= 10,
  );

  /** Tahta dolmaya yakınken uyarı. */
  protected readonly assistantWarning = computed(
    () =>
      this.assistantOn() &&
      this.status() === GameStatus.Playing &&
      !this.autoplaying() &&
      this.mode() !== GameMode.Race &&
      this.game.emptyCount() <= 2,
  );

  constructor() {
    // YZ Asistanı açıksa: oyun bitince performans analizini otomatik göster,
    // yeni oyun/oynanırken temizle. (Kapalıyken 🔍 butonu manuel çalışır.)
    effect(() => {
      const s = this.status();
      const terminal =
        s === GameStatus.Won ||
        s === GameStatus.Lost ||
        s === GameStatus.Failed ||
        s === GameStatus.LevelComplete;
      untracked(() => {
        if (terminal) {
          if (this.assistantOn()) this.analysisText.set(this.ai.localAnalysis());
        } else {
          this.analysisText.set('');
          // Yeni oyun / oynanırken kişisel koç metnini de temizle (bir sonraki
          // oyunda eski koç metni görünmesin; her oyun için tek çağrı korunur).
          this.coachText.set('');
          this.coachIsAi.set(false);
          this.coachLoading.set(false);
        }
      });
    });
  }

  /**
   * Oyuncunun görünen adı. Botlarda ad, seviyeden ve AKTİF DİLDEN üretilir
   * (dil değişince bot adı da güncellenir). Seviye verisi yoksa sunucu adına düşer.
   */
  protected mpPlayerName(p: RoomPlayer): string {
    if (p.isBot) {
      if (isBotCharacter(p.character)) {
        return `${BOT_CHARACTERS[p.character].avatar} ${this.t('char.' + p.character + '.name')}`;
      }
      if (isAiLevel(p.level)) {
        const key = 'mp.bot' + p.level[0].toUpperCase() + p.level.slice(1);
        return `🤖 Bot (${this.t(key)})`;
      }
    }
    return p.username;
  }

  /**
   * Yarış içi karakter laf atması (kişiliği pekiştirir). Tetikleyici anlık
   * sıralamadan türer: yarış başı (skor 0) → start; bot önümdeyse → lead; ben
   * botu geçtiysem → behind. Yalnızca karakter botları ve yarış sürerken.
   */
  protected botTaunt(p: RoomPlayer): string | null {
    if (!isBotCharacter(p.character) || this.status() !== GameStatus.Playing) return null;
    const me = this.mpPlayers().find((x) => this.isMe(x.id));
    const trigger = p.score === 0 ? 'start' : !me || p.score > me.score ? 'lead' : 'behind';
    return this.t(`char.${p.character}.taunt.${trigger}`);
  }

  /** Bir oyuncu ben miyim? */
  protected isMe(playerId: number): boolean {
    return playerId === this.auth.user()?.id;
  }

  /** Pozisyon sağlığına göre gösterge simgesi. */
  protected healthIcon(): string {
    const l = this.health().level;
    return l === 'good' ? '🟢' : l === 'risky' ? '🟡' : '🔴';
  }

  /** Yön → ok işareti. */
  protected arrowFor(d: Direction): string {
    return d === Direction.Left
      ? '←'
      : d === Direction.Right
        ? '→'
        : d === Direction.Up
          ? '↑'
          : '↓';
  }

  /** Öneri iste (hak varsa). */
  onRequestHint(): void {
    this.game.requestAssistHint();
  }

  /** Sahip olunan gücü kullan. */
  onUsePower(id: PowerId): void {
    this.game.usePower(id);
  }

  /** Bomba hedeflemeyi iptal et. */
  onCancelBomb(): void {
    this.game.cancelBomb();
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

  /** YZ otomatik oynatmayı aç/kapat ("YZ'yi izle"). */
  onToggleAutoplay(): void {
    this.game.toggleAutoplay('expert');
  }

  /** Oyunu duraklat / devam ettir. */
  onTogglePause(): void {
    this.game.togglePause();
  }

  /** Seviye modunu başlat (overlay'den "Baştan"). */
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

  /** Biten oyunu YZ ile (algoritmik, anlık) değerlendir. */
  onAnalyze(): void {
    this.analysisText.set(this.ai.localAnalysis());
  }

  /**
   * Kişisel LLM koç metnini iste (oyun başına tek çağrı). Sunucu erişilemez /
   * anahtar yok / hız sınırı dolu ise sessizce yerel şablona düşer (`ai:false`).
   */
  async onCoach(): Promise<void> {
    if (this.coachLoading() || this.coachText()) return; // zaten yüklendi/yükleniyor
    this.coachLoading.set(true);
    try {
      const result = await this.ai.coach();
      this.coachText.set(result.text);
      this.coachIsAi.set(result.ai);
    } finally {
      this.coachLoading.set(false);
    }
  }
}
