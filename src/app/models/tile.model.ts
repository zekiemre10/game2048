// ============================================================
//  2048 — Temel veri modelleri
// ============================================================

/** Tahtadaki tek bir taşı temsil eder. */
export interface Tile {
  /** Benzersiz kimlik (animasyonları takip etmek için). */
  id: number;
  /** Taşın değeri: 2, 4, 8, ... */
  value: number;
  /** Satır indeksi (0-3). */
  row: number;
  /** Sütun indeksi (0-3). */
  col: number;
  /** Bu hamlede yeni oluştu mu? */
  isNew?: boolean;
  /** Bu hamlede birleşti mi? */
  merged?: boolean;
}

/** Oyuncunun yapabileceği hamle yönleri. */
export enum Direction {
  Up = 'up',
  Down = 'down',
  Left = 'left',
  Right = 'right',
}

/** Oyunun genel durumu. */
export enum GameStatus {
  /** Henüz başlanmadı — başlık ekranı. */
  Idle = 'idle',
  /** Oynanıyor. */
  Playing = 'playing',
  /** (Klasik) 2048'e ulaşıldı / (Seviye) tüm seviyeler bitti. */
  Won = 'won',
  /** (Klasik) Hamle kalmadı. */
  Lost = 'lost',
  /** (Seviye) Seviye hedefine ulaşıldı — sonraki seviye bekleniyor. */
  LevelComplete = 'levelComplete',
  /** (Seviye) Süre doldu veya hamle kalmadı — seviye başarısız. */
  Failed = 'failed',
}

/** Oyun modu. */
export enum GameMode {
  /** Klasik sonsuz 2048 (süre yukarı sayar). */
  Classic = 'classic',
  /** Seviye modu (hedef + geri sayım). */
  Level = 'level',
  /** Zen: süresiz, baskısız (2048'de durmaz). */
  Zen = 'zen',
  /** Zaman Yarışı: sabit süre, en yüksek skor. */
  TimeAttack = 'timeAttack',
  /** Çok oyunculu yarış: ortak tohum, sabit süre, canlı skor tablosu. */
  Race = 'race',
}

/** Zaman Yarışı modunun süresi (saniye). */
export const TIME_ATTACK_SECONDS = 180;

/** Seçilebilir tahta boyutları. */
export const BOARD_SIZES = [3, 4, 5] as const;

/** Tahta boyutu (4x4). */
export const BOARD_SIZE = 4;

/** 4×4 ızgaranın 2B görünümü: her hücre ya bir Tile ya da boş (null). */
export type Grid = (Tile | null)[][];

/** Boş bir hücrenin konumu. */
export interface Cell {
  row: number;
  col: number;
}
