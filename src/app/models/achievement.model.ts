// ============================================================
//  2048 — Başarımlar (altın ödüllü hedefler)
//  Koşullar GameService.achievementMet() içinde değerlendirilir.
// ============================================================

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  /** Açılınca verilen altın. */
  gold: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'tile-512', icon: '🥉', name: '512 Kulübü', nameEn: '512 Club', desc: '512 karesi yap', descEn: 'Make a 512 tile', gold: 50 },
  { id: 'tile-1024', icon: '🥈', name: '1024 Kulübü', nameEn: '1024 Club', desc: '1024 karesi yap', descEn: 'Make a 1024 tile', gold: 75 },
  { id: 'first-win', icon: '🏆', name: 'İlk Zafer', nameEn: 'First Win', desc: '2048 karesine ulaş', descEn: 'Reach the 2048 tile', gold: 150 },
  { id: 'level-3', icon: '🎯', name: 'Seviye Avcısı', nameEn: 'Level Hunter', desc: "Seviye 3'e ulaş", descEn: 'Reach level 3', gold: 80 },
  { id: 'games-10', icon: '🎮', name: 'Meraklı', nameEn: 'Curious', desc: '10 oyun oyna', descEn: 'Play 10 games', gold: 40 },
  { id: 'streak-3', icon: '🔥', name: 'İstikrar', nameEn: 'Consistency', desc: '3 gün üst üste oyna', descEn: 'Play 3 days in a row', gold: 60 },
  { id: 'streak-7', icon: '⚡', name: 'Bağımlı', nameEn: 'Addicted', desc: '7 gün üst üste oyna', descEn: 'Play 7 days in a row', gold: 150 },
  { id: 'bomb-use', icon: '💣', name: 'Bombacı', nameEn: 'Bomber', desc: 'İlk bombanı kullan', descEn: 'Use your first bomb', gold: 30 },
  { id: 'rich', icon: '💰', name: 'Zengin', nameEn: 'Rich', desc: 'Toplam 1000 altın kazan', descEn: 'Earn 1000 gold total', gold: 100 },
];
