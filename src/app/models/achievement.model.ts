// ============================================================
//  2048 — Başarımlar (altın ödüllü hedefler)
//  Koşullar GameService.achievementMet() içinde değerlendirilir.
// ============================================================

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** Açılınca verilen altın. */
  gold: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'tile-512', icon: '🥉', name: '512 Kulübü', desc: '512 karesi yap', gold: 50 },
  { id: 'tile-1024', icon: '🥈', name: '1024 Kulübü', desc: '1024 karesi yap', gold: 75 },
  { id: 'first-win', icon: '🏆', name: 'İlk Zafer', desc: '2048 karesine ulaş', gold: 150 },
  { id: 'level-3', icon: '🎯', name: 'Seviye Avcısı', desc: "Seviye 3'e ulaş", gold: 80 },
  { id: 'games-10', icon: '🎮', name: 'Meraklı', desc: '10 oyun oyna', gold: 40 },
  { id: 'streak-3', icon: '🔥', name: 'İstikrar', desc: '3 gün üst üste oyna', gold: 60 },
  { id: 'streak-7', icon: '⚡', name: 'Bağımlı', desc: '7 gün üst üste oyna', gold: 150 },
  { id: 'bomb-use', icon: '💣', name: 'Bombacı', desc: 'İlk bombanı kullan', gold: 30 },
  { id: 'rich', icon: '💰', name: 'Zengin', desc: 'Toplam 1000 altın kazan', gold: 100 },
];
