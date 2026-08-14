import { Injectable, computed, inject, signal } from '@angular/core';
import { Direction, GameMode, GameStatus } from '../models/tile.model';
import { applyMove, hasAnyMove } from '../logic/board-logic';
import { rankFor, rankPoints } from '../logic/rank';
import { MAX_LEVEL, levelConfig } from '../models/level.model';
import { PowerId } from '../models/power.model';
import { MissionMetric } from '../models/mission.model';
import { BoardStore } from './board-store';
import { TimerService } from './timer.service';
import { AssistantStore } from './assistant-store';
import { EconomyService } from './economy.service';
import { MissionsService } from './missions.service';
import { ProfileService } from './profile.service';
import { AchievementsService, AchievementStats } from './achievements.service';
import { RewardsService } from './rewards.service';
import { PowersService } from './powers.service';
import { loadRewardedLevels, saveRewardedLevels } from './game-storage';

/** Kutlama türü — arayüz hangi sesi/mesajı göstereceğini seçer. */
export type CelebrationKind = 'win' | 'level' | 'achievement';

/** Kazanma değeri. */
const WIN_VALUE = 2048;

/**
 * Oyun motoru: hamle akışı + oyun-sonu kuralları + skor/rekor + başarım/görev/
 * ödül orkestrasyonu + kutlama tetikleme.
 *
 * Tüm DURUM alt servislerde (BoardStore, domain servisleri); motor onları
 * enjekte edip ORKESTRE eder. Mod kurulumu, otomatik oynatma ve güç efektleri
 * bu motoru enjekte eder (tek yön: modes/autoplay/effects → engine → durum),
 * böylece döngü oluşmaz.
 */
@Injectable({ providedIn: 'root' })
export class GameEngine {
  private readonly board = inject(BoardStore);
  private readonly timer = inject(TimerService);
  private readonly assistant = inject(AssistantStore);
  private readonly economy = inject(EconomyService);
  private readonly missions = inject(MissionsService);
  private readonly profile = inject(ProfileService);
  private readonly achievements = inject(AchievementsService);
  private readonly rewards = inject(RewardsService);
  private readonly powers = inject(PowersService);

  /** Son seviye tamamlamada kazanılan altın (0 → zaten alınmıştı). */
  readonly lastReward = signal<number>(0);

  /** Ödülü zaten alınmış seviyeler (tekrar tamamlamada altın verilmez). */
  private readonly rewardedLevels = new Set<number>(loadRewardedLevels());

  /**
   * Kutlama olayı: her yeni başarı anında `id` artar; arayüz bunu izleyip
   * konfeti + ses oynatır. YZ oynadıysa kutlama YOK (gerçek başarı değil).
   */
  readonly celebration = signal<{ id: number; kind: CelebrationKind } | null>(null);
  private celebrationId = 0;

  /** Oyuncu ünvanı: toplam ilerlemeyi tek bir rütbeye indirger. */
  readonly rankInfo = computed(() =>
    rankFor(
      rankPoints({
        gamesPlayed: this.profile.gamesPlayed(),
        bestScore: this.profile.bestScore(),
        bestLevel: this.profile.bestLevel(),
        achievements: this.achievements.unlocked().size,
      }),
    ),
  );

  // --- Altın ekonomisi orkestrasyonu --------------------------

  /** Altın ekler (kazanç → toplam kazanç + "altın kazan" görevi). */
  addGold(amount: number): void {
    if (amount <= 0) return;
    this.economy.add(amount);
    this.trackMission('gold', amount);
  }

  /** Altın harcar. Yeterli değilse harcamaz. */
  spendGold(amount: number): boolean {
    return this.economy.spend(amount);
  }

  // --- Görevler + başarımlar ----------------------------------

  /** Bir metrik için görev ilerlemesini bildirir (YZ oynadıysa sayılmaz). */
  trackMission(metric: MissionMetric, amount: number): void {
    this.missions.track(metric, amount, this.assistant.aiPlayed());
  }

  /** Tamamlanmış bir görevin ödülünü alır. */
  claimMission(id: string, type: 'daily' | 'weekly'): boolean {
    return this.missions.claim(id, type, this.assistant.aiPlayed());
  }

  /** Bir başarımın ilerlemesi: `{ current, target }` (kilitli çubuğu çizmek için). */
  achievementProgress(id: string): { current: number; target: number } {
    return this.achievements.progress(id, this.achStats());
  }

  /** Başarım koşullarının okuduğu anlık ilerleme görüntüsü (profil+ekonomi+seri). */
  private achStats(): AchievementStats {
    return {
      bestTile: this.profile.bestTile(),
      bestLevel: this.profile.bestLevel(),
      gamesPlayed: this.profile.gamesPlayed(),
      bestStreak: this.rewards.bestStreak(),
      bombUsed: this.profile.bombUsed(),
      totalGoldEarned: this.economy.totalGoldEarned(),
    };
  }

  /**
   * Koşulu sağlanan yeni başarımları açar ve ödül altınını verip kutlamayı
   * tetikler. Altın ödülü ayrıca "altın kazan" görevini de ilerletir.
   */
  checkAchievements(): void {
    const newly = this.achievements.unlockNew(this.achStats());
    if (newly.length === 0) return;
    for (const a of newly) this.addGold(a.gold);
    this.celebrate('achievement'); // yeni başarım açıldı 🎉
  }

  private celebrate(kind: CelebrationKind): void {
    if (this.assistant.aiPlayed()) return;
    this.celebration.set({ id: ++this.celebrationId, kind });
  }

  // --- İstatistik / rekor güncelleme --------------------------

  /** Oyun sonunda istatistikleri günceller (istatistik ProfileService'te). */
  recordGameEnd(won: boolean): void {
    if (this.assistant.aiPlayed()) return; // YZ oynadıysa ilerleme sayılmaz
    this.profile.recordGame(won, this.board.moves());
    this.checkAchievements();
    this.trackMission('games', 1);
    if (won) this.trackMission('wins', 1);
  }

  /** Tahtadaki en yüksek kareyi izler (başarım için). */
  private updateBestTile(): void {
    if (this.assistant.aiPlayed()) return; // YZ oynadıysa istatistik sayılmaz
    let max = this.profile.bestTile();
    for (const t of this.board.tiles()) if (t.value > max) max = t.value;
    if (this.profile.reportBestTile(max)) this.checkAchievements();
  }

  /** Anlık skor en yüksek skoru geçtiyse güncelle (ProfileService). */
  private updateBestScore(): void {
    if (this.assistant.aiPlayed()) return; // YZ oynadıysa rekor sayılmaz
    this.profile.reportBestScore(this.board.score());
  }

  // --- Hamle akışı --------------------------------------------

  /**
   * Verilen yöne hamle yapar. Geçersizse (ızgara değişmediyse) hiçbir şey
   * yapmaz. @returns hamle geçerli olduysa true.
   */
  move(direction: Direction): boolean {
    if (this.board.status() !== GameStatus.Playing) return false;

    const result = applyMove(this.board.tiles(), direction, this.board.boardSize());
    if (!result.moved) return false; // geçersiz hamle → sayaç ARTMAZ

    // Doğrulama transkriptine ekle (yalnızca UYGULANAN hamleler).
    this.board.recordMove(direction);

    // Hamle kalitesi: YALNIZCA insan hamleleri, asistan açıkken, tahta değişmeden.
    this.assistant.recordReview(direction);
    this.assistant.assistHintDir.set(null); // öneri yalnızca gösterildiği tahta içindi

    // Geçerli hamle → hamle ÖNCESİ durumu sakla (geri al için). applyMove saf
    // olduğundan tiles() hâlâ hamle öncesi listedir; anlık görüntü sayaç ARTMADAN
    // alınır (geri alınca sayaç da doğru değere döner).
    this.board.history.set({
      tiles: this.board.tiles(),
      score: this.board.score(),
      moves: this.board.moves(),
      status: this.board.status(),
      keepPlayingAfterWin: this.board.keepPlaying(),
    });

    this.board.moves.update((m) => m + 1);
    this.board.tiles.set(result.tiles);

    // Görev takibi: hamle + birleşme + kare hedefleri
    this.trackMission('moves', 1);
    const mergedTiles = result.tiles.filter((t) => t.merged);
    if (mergedTiles.length > 0) {
      this.trackMission('merges', mergedTiles.length);
      const maxMerged = Math.max(...mergedTiles.map((t) => t.value));
      if (maxMerged >= 256) this.trackMission('reach256', 1);
      if (maxMerged >= 512) this.trackMission('reach512', 1);
      if (maxMerged >= 1024) this.trackMission('reach1024', 1);
    }

    if (result.gained > 0) {
      this.board.score.update((s) => s + result.gained);
      this.updateBestScore();
    }

    this.board.spawnRandomTile(); // her geçerli hamleden sonra yeni bir kare
    this.updateBestTile();

    switch (this.board.mode()) {
      case GameMode.Level:
        this.checkLevelEnd();
        break;
      case GameMode.Classic:
        this.checkClassicEnd();
        break;
      default:
        this.checkEndlessEnd(); // Zen & Zaman Yarışı: 2048'de durmaz
    }
    return true;
  }

  /** Klasik mod: 2048'e ulaşınca kazanma, hamle kalmayınca kaybetme. */
  private checkClassicEnd(): void {
    if (!this.board.keepPlaying() && this.board.tiles().some((t) => t.value >= WIN_VALUE)) {
      this.timer.stopTimer(); // süre "tamamlama" anında donar
      this.board.status.set(GameStatus.Won);
      this.recordGameEnd(true);
      this.celebrate('win'); // 2048'e ulaşıldı 🎉
      return;
    }
    if (!hasAnyMove(this.board.tiles(), this.board.boardSize())) {
      this.timer.stopTimer();
      this.board.status.set(GameStatus.Lost);
      this.recordGameEnd(false);
    }
  }

  /** Zen / Zaman Yarışı: kazanma yok; hamle kalmayınca oyun biter. */
  private checkEndlessEnd(): void {
    if (!hasAnyMove(this.board.tiles(), this.board.boardSize())) {
      this.timer.stopTimer();
      this.board.status.set(GameStatus.Lost);
      this.recordGameEnd(false);
    }
  }

  /**
   * Seviye modu: hedefe ulaşıldıysa tamamlandı (son seviyede tüm oyun kazanıldı);
   * hamle kalmadıysa başarısız.
   */
  private checkLevelEnd(): void {
    if (this.board.tiles().some((t) => t.value >= this.board.levelTarget())) {
      this.timer.stopTimer();
      // Ödül + görev YALNIZCA ilk tamamlamada (tekrar bitirip çiftlemek engellenir).
      const firstTime = this.awardGold(this.board.level());
      if (firstTime) this.trackMission('levels', 1);
      if (this.board.level() >= MAX_LEVEL) {
        this.board.status.set(GameStatus.Won);
        this.recordGameEnd(true); // tüm seviyeler bitti = kazanılmış oyun
        this.celebrate('win');
      } else {
        this.board.status.set(GameStatus.LevelComplete);
        this.celebrate('level');
      }
      return;
    }
    if (!hasAnyMove(this.board.tiles(), this.board.boardSize())) {
      this.timer.stopTimer();
      this.board.status.set(GameStatus.Failed); // Başarısız → altın YOK
      this.recordGameEnd(false);
    }
  }

  /**
   * Seviye tamamlanınca altın verir — YALNIZCA İLK tamamlamada (farming önlenir).
   * `lastReward` = bu tamamlamada kazanılan altın (0 → zaten alınmıştı).
   */
  private awardGold(level: number): boolean {
    if (this.assistant.aiPlayed()) {
      this.lastReward.set(0); // YZ oynadıysa altın verilmez
      return false;
    }
    if (this.rewardedLevels.has(level)) {
      this.lastReward.set(0); // ödül zaten alınmış
      return false;
    }
    const reward = levelConfig(level).gold;
    this.rewardedLevels.add(level);
    this.addGold(reward);
    this.lastReward.set(reward);
    saveRewardedLevels(this.rewardedLevels);
    return true;
  }

  /** Geri sayım bittiğinde (TimerService çağırır): moda göre oyun-sonu. */
  onCountdownExpire(): void {
    // Seviye modunda başarısız; Zaman Yarışı'nda oyun biter (skor kalır).
    if (this.board.mode() === GameMode.Level) {
      this.board.status.set(GameStatus.Failed);
    } else {
      this.board.status.set(GameStatus.Lost);
    }
    this.recordGameEnd(false); // süreden kaybetmek de oynanmış bir oyundur
  }

  /** Kazandıktan sonra "Devam Et": oyuna geri dön, kazanmayı bir daha tetikleme. */
  continueAfterWin(): void {
    if (this.board.status() !== GameStatus.Won) return;
    this.board.keepPlaying.set(true);
    this.board.status.set(GameStatus.Playing);
    this.timer.startUp(this.timer.elapsedSeconds()); // donmuş değerden ileri
  }

  // --- Gün serisi + ödüller -----------------------------------

  /**
   * Oyun başlangıcında günün aktivitesini kaydeder (RewardsService seriyi
   * ilerletir); ardından seri-başarımlarını kontrol eder (orkestrasyon).
   */
  registerActivity(): void {
    this.rewards.registerActivity();
    this.checkAchievements();
  }

  /**
   * Günlük ödülü alır (günde bir kez). Seri + ödül durumunu RewardsService
   * işler; altın/güç envantere ekleme, seri-başarımı ve kutlama motorda.
   */
  claimDailyReward(): boolean {
    const reward = this.rewards.claimDaily();
    if (!reward) return false; // bugün alınmış
    this.checkAchievements(); // seri güncellendi → seri başarımları
    if (reward.gold > 0) this.addGold(reward.gold);
    if (reward.power) this.powers.add(reward.power, reward.powerCount);
    this.celebrate('achievement'); // ödül alındı 🎉
    return true;
  }

  /**
   * Ay sonu şampiyonluk ödülünü envantere ekler (altın + güçler); şampiyonluk
   * sayısını artırır. Sunucu ödülü kendi tarafında işaretler.
   */
  grantChampionPrize(gold: number, powers: Record<string, number>): void {
    if (gold > 0) this.addGold(gold);
    const inv = this.powers.inventory();
    for (const [id, count] of Object.entries(powers ?? {})) {
      if (id in inv && typeof count === 'number' && count > 0) {
        this.powers.add(id as PowerId, count);
      }
    }
    this.profile.addChampionship();
  }
}
