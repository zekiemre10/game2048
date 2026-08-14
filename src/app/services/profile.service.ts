import { Injectable, computed, signal } from '@angular/core';
import {
  AVATARS,
  CharacterWinsBlob,
  RecentScoresBlob,
  loadAvatar,
  loadBestLevel,
  loadBestScore,
  loadChampionships,
  loadCharacterWins,
  loadLastAdaptive,
  loadName,
  loadPrefsAt,
  loadRecentScores,
  loadStat,
  saveAvatar,
  saveBestLevel,
  saveBestScore,
  saveChampionships,
  saveCharacterWins,
  saveLastAdaptive,
  saveName,
  savePrefsAt,
  saveRecentScores,
  saveStats,
} from './game-storage';

/** Uyarlanabilir eşleştirme için tutulan son oyun sayısı (kayan pencere). */
const RECENT_WINDOW = 5;

/**
 * Oyuncu profili: kimlik (ad/avatar/şampiyonluk), rekorlar (en yüksek skor/
 * seviye) ve ömürlük istatistikler (oynanan/kazanılan oyun, en yüksek kare,
 * toplam hamle, bomba kullanıldı mı) + kazanma oranı.
 *
 * Tek sorumluluk = oyuncu meta verisi. Hiçbir bağımlılığı yok (yaprak servis);
 * başarımlar bu servisi enjekte ederek koşulları okur. Gün serisi (streak)
 * günlük ödüllerle iç içe olduğundan ödül servisinde tutulur, burada DEĞİL.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  // --- Kimlik ------------------------------------------------
  readonly playerName = signal<string>(loadName());
  readonly avatar = signal<string>(loadAvatar());
  /** Kazanılan ay sonu şampiyonluğu sayısı (profilde rozet). */
  readonly championships = signal<number>(loadChampionships());
  /** Ad/avatar son değişiklik damgası (bulut birleştirmede tercih LWW'si için). */
  readonly prefsUpdatedAt = signal<number>(loadPrefsAt());

  // --- Rekorlar ----------------------------------------------
  readonly bestScore = signal<number>(loadBestScore());
  readonly bestLevel = signal<number>(loadBestLevel());

  // --- Ömürlük istatistikler ---------------------------------
  readonly gamesPlayed = signal<number>(loadStat('gamesPlayed'));
  readonly gamesWon = signal<number>(loadStat('gamesWon'));
  readonly bestTile = signal<number>(loadStat('bestTile'));
  readonly totalMoves = signal<number>(loadStat('totalMoves'));
  readonly bombUsed = signal<boolean>(loadStat('bombUsed') === 1);

  /** Kazanma oranı (%). Oynanmış oyun yoksa 0. */
  readonly winRate = computed<number>(() => {
    const played = this.gamesPlayed();
    return played === 0 ? 0 : Math.round((this.gamesWon() / played) * 100);
  });

  /** Karakter bazlı yarış galibiyeti (id → {faced, beaten}). Cihaz-yerel. */
  readonly characterWins = signal<CharacterWinsBlob>(loadCharacterWins());

  // --- Uyarlanabilir eşleştirme (kayan pencere + son rung) ---
  /** Tahta boyutuna göre son oyun skorları (kayan pencere). Cihaz-yerel. */
  readonly recentScores = signal<RecentScoresBlob>(loadRecentScores());
  /** Son eşlenen uyarlanabilir rung anahtarı (basamak yumuşatması için). */
  readonly lastAdaptiveKey = signal<string>(loadLastAdaptive());

  /**
   * Bir oyun bitince skoru boyut penceresine ekler (en fazla RECENT_WINDOW).
   * Yarış + YZ oynanan oyunlar HARİÇ (oyuncu becerisini yansıtmalı). Boyut,
   * skoru çok etkilediği için ayrı tutulur.
   */
  recordRecentScore(size: number, score: number): void {
    if (score <= 0) return;
    const key = String(size);
    this.recentScores.update((prev) => {
      const list = [...(prev[key] ?? []), score].slice(-RECENT_WINDOW);
      const next = { ...prev, [key]: list };
      saveRecentScores(next);
      return next;
    });
  }

  /** Bir tahta boyutundaki son oyunların ortalama skoru (yoksa 0). */
  recentAvg(size: number): number {
    const list = this.recentScores()[String(size)] ?? [];
    if (!list.length) return 0;
    return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }

  /** Son eşlenen rung'ı kaydeder (yumuşatma bir sonraki eşleşmede kullanır). */
  setLastAdaptiveKey(key: string): void {
    this.lastAdaptiveKey.set(key);
    saveLastAdaptive(key);
  }

  /**
   * Bir yarış bitince karakter sonuçlarını işler: her karşılaşılan karakterin
   * `faced` sayacı artar; skorca geçildiyse `beaten` de artar. (Çok oyunculu
   * yarış sonu — tek oyunculu recordGame'den ayrı.)
   */
  recordCharacterResults(results: { id: string; beaten: boolean }[]): void {
    if (!results.length) return;
    this.characterWins.update((prev) => {
      const next: CharacterWinsBlob = { ...prev };
      for (const r of results) {
        const cur = next[r.id] ?? { faced: 0, beaten: 0 };
        next[r.id] = { faced: cur.faced + 1, beaten: cur.beaten + (r.beaten ? 1 : 0) };
      }
      saveCharacterWins(next);
      return next;
    });
  }

  /** Oyuncu adını ayarlar (temizle + kaydet + tercih damgası). */
  setName(name: string): void {
    const clean = name.trim().slice(0, 16) || 'Oyuncu';
    this.playerName.set(clean);
    saveName(clean);
    this.touchPrefs();
  }

  /** Avatarı değiştirir; listede olmayan bir değer yok sayılır. */
  setAvatar(a: string): void {
    if (!AVATARS.includes(a)) return;
    this.avatar.set(a);
    saveAvatar(a);
    this.touchPrefs();
  }

  /** Tercih (ad/avatar) değiştiğinde zaman damgasını günceller. */
  private touchPrefs(): void {
    const ts = Date.now();
    this.prefsUpdatedAt.set(ts);
    savePrefsAt(ts);
  }

  /** Oyun sonu istatistiklerini işler. */
  recordGame(won: boolean, moves: number): void {
    this.gamesPlayed.update((n) => n + 1);
    if (won) this.gamesWon.update((n) => n + 1);
    this.totalMoves.update((n) => n + moves);
    this.saveStats();
  }

  /** Yeni skor rekoru bildirir (yalnız daha yüksekse kaydeder). */
  reportBestScore(score: number): void {
    if (score > this.bestScore()) {
      this.bestScore.set(score);
      saveBestScore(score);
    }
  }

  /** Yeni en yüksek seviye bildirir (yalnız daha yüksekse kaydeder). */
  reportBestLevel(level: number): void {
    if (level > this.bestLevel()) {
      this.bestLevel.set(level);
      saveBestLevel(level);
    }
  }

  /** Tahtadaki en yüksek kareyi bildirir. @returns rekor değiştiyse true. */
  reportBestTile(max: number): boolean {
    if (max !== this.bestTile()) {
      this.bestTile.set(max);
      this.saveStats();
      return true;
    }
    return false;
  }

  /** İlk bomba kullanımını işaretler. @returns ilk kez ise true (başarım için). */
  markBombUsed(): boolean {
    if (this.bombUsed()) return false;
    this.bombUsed.set(true);
    this.saveStats();
    return true;
  }

  /** Ay sonu şampiyonluğu ekler. */
  addChampionship(): void {
    this.championships.update((n) => n + 1);
    saveChampionships(this.championships());
  }

  /** İstatistik blob'unu kalıcı kaydeder. */
  saveStats(): void {
    saveStats({
      gamesPlayed: this.gamesPlayed(),
      gamesWon: this.gamesWon(),
      bestTile: this.bestTile(),
      totalMoves: this.totalMoves(),
      bombUsed: this.bombUsed() ? 1 : 0,
    });
  }

  /** Profil/rekor/istatistiklerin tümünü kalıcı kaydeder (bulut geri yükleme sonrası). */
  persist(): void {
    saveName(this.playerName());
    saveAvatar(this.avatar());
    saveChampionships(this.championships());
    savePrefsAt(this.prefsUpdatedAt());
    saveBestScore(this.bestScore());
    saveBestLevel(this.bestLevel());
    this.saveStats();
  }
}
