import { Injectable, signal } from '@angular/core';

// ============================================================
//  2048 — Dil servisi (TR / EN)
//  Statik metinler DICT'ten t() ile; model verileri L(tr,en) ile.
//  Tercih localStorage'da saklanır.
// ============================================================

export type Lang = 'tr' | 'en';

const LANG_KEY = 'game2048.lang';

/** Tüm statik arayüz metinleri. */
const DICT: Record<string, { tr: string; en: string }> = {
  // Başlık ekranı
  'start.subtitle': {
    tr: "Taşları birleştir, <strong>2048</strong>'e ulaş!",
    en: 'Merge the tiles, reach <strong>2048</strong>!',
  },
  'start.play': { tr: 'Başla', en: 'Play' },
  'start.levelMode': { tr: '🎯 Seviye Modu', en: '🎯 Level Mode' },
  'start.modeLabel': { tr: 'MOD', en: 'MODE' },
  'start.sizeLabel': { tr: 'TAHTA', en: 'BOARD' },
  'mode.classic': { tr: 'Klasik', en: 'Classic' },
  'mode.classicDesc': { tr: 'Sonsuz · 2048’e ulaş', en: 'Endless · reach 2048' },
  'mode.zen': { tr: 'Zen', en: 'Zen' },
  'mode.zenDesc': { tr: 'Süresiz · rahat', en: 'No timer · relaxed' },
  'mode.timeAttack': { tr: 'Zaman Yarışı', en: 'Time Attack' },
  'mode.timeAttackDesc': { tr: '3 dakika · en yüksek skor', en: '3 minutes · best score' },
  'mode.level': { tr: 'Seviye', en: 'Level' },
  'mode.levelDesc': { tr: 'Hedef · geri sayım', en: 'Target · countdown' },
  'start.totalGold': { tr: '💰 Toplam altın:', en: '💰 Total gold:' },
  'start.bestLevel': { tr: '🏅 Ulaşılan en yüksek seviye:', en: '🏅 Highest level reached:' },
  'start.hint': {
    tr: 'Ok tuşlarıyla oyna · Aynı sayıları birleştir',
    en: 'Play with arrow keys · Merge equal numbers',
  },

  // HUD
  'hud.score': { tr: 'SKOR', en: 'SCORE' },
  'hud.best': { tr: 'EN İYİ', en: 'BEST' },
  'hud.time': { tr: 'SÜRE', en: 'TIME' },
  'hud.remaining': { tr: 'KALAN', en: 'LEFT' },
  'hud.moves': { tr: 'HAMLE', en: 'MOVES' },
  'hud.level': { tr: 'Seviye', en: 'Level' },
  'hud.target': { tr: 'Hedef:', en: 'Target:' },

  // Butonlar
  'btn.undo': { tr: '↶ Geri Al', en: '↶ Undo' },
  'btn.newGame': { tr: 'Yeni Oyun', en: 'New Game' },
  'btn.restart': { tr: 'Baştan', en: 'Restart' },
  'btn.close': { tr: 'Kapat', en: 'Close' },
  'btn.aiPlay': { tr: '🤖 YZ Oynasın', en: '🤖 Let AI Play' },
  'btn.aiStop': { tr: '⏹ YZ Durdur', en: '⏹ Stop AI' },
  'pause.pause': { tr: '⏸ Duraklat', en: '⏸ Pause' },
  'pause.resume': { tr: '▶ Devam', en: '▶ Resume' },
  'pause.paused': { tr: 'Duraklatıldı', en: 'Paused' },
  'pause.tap': { tr: 'Devam etmek için dokun', en: 'Tap to resume' },

  // Bomba
  'bomb.hint': { tr: '💣 Silmek için bir kareye dokun', en: '💣 Tap a tile to remove it' },
  'bomb.cancel': { tr: 'İptal', en: 'Cancel' },

  // Overlay
  'ov.wonAllTitle': { tr: 'Tebrikler! 🏆', en: 'Congrats! 🏆' },
  'ov.wonAllSub': { tr: 'Tüm seviyeleri bitirdin', en: 'You beat all levels' },
  'ov.wonTitle': { tr: 'Kazandın! 🎉', en: 'You Won! 🎉' },
  'ov.wonSub': { tr: "2048'e ulaştın", en: 'You reached 2048' },
  'ov.levelDoneTitle': { tr: 'Seviye {n} Tamamlandı! 🎉', en: 'Level {n} Complete! 🎉' },
  'ov.levelDoneSub': { tr: 'Hedefe ulaştın ({x})', en: 'Target reached ({x})' },
  'ov.failTitle': { tr: 'Başarısız', en: 'Failed' },
  'ov.timeUp': { tr: 'Süre doldu!', en: "Time's up!" },
  'ov.noMoves': { tr: 'Hamle kalmadı', en: 'No moves left' },
  'ov.gameOver': { tr: 'Oyun Bitti', en: 'Game Over' },
  'ov.score': { tr: 'Skor:', en: 'Score:' },
  'ov.left': { tr: 'kaldı', en: 'left' },
  'ov.movesSuffix': { tr: 'hamle', en: 'moves' },
  'ov.goldWon': { tr: '+{g} altın kazandın!', en: '+{g} gold earned!' },
  'ov.goldAlready': {
    tr: 'Bu seviyenin ödülü zaten alınmıştı',
    en: "This level's reward was already claimed",
  },
  'ov.nextLevel': { tr: 'Sonraki Seviye →', en: 'Next Level →' },
  'ov.retry': { tr: '↻ Tekrar Dene', en: '↻ Try Again' },
  'ov.continue': { tr: 'Devam Et', en: 'Keep Going' },

  // Ayarlar
  'set.title': { tr: '⚙️ Ayarlar', en: '⚙️ Settings' },
  'set.note': {
    tr: 'Ayarların otomatik kaydedilir ve oyunu tekrar açtığında korunur.',
    en: 'Your settings are saved automatically and kept next time.',
  },
  'set.sound': { tr: '🔊 SES', en: '🔊 SOUND' },
  'set.music': { tr: 'Müzik', en: 'Music' },
  'set.musicVol': { tr: 'Müzik sesi', en: 'Music volume' },
  'set.sfxVol': { tr: 'Efekt sesleri', en: 'Sound effects' },
  'set.assistant': { tr: '🧠 YZ ASİSTANI', en: '🧠 AI ASSISTANT' },
  'set.assistantLabel': { tr: 'Asistan', en: 'Assistant' },
  'set.assistantDesc': {
    tr: 'Açıkken oyun başına 5 hamle önerisi hakkı verir (istediğinde kullanırsın), tahta dolunca uyarır; oyun sonunda performans analizi verir.',
    en: 'When on, gives 5 move hints per game (use them when you want), warns when the board fills up, and shows a performance analysis at the end.',
  },
  'ai.demoNote': {
    tr: '🤖 YZ gösterimi — durdurunca kendi oyununa dönersin',
    en: '🤖 AI demo — stop it to return to your own game',
  },
  'ai.demoEnded': {
    tr: '↩️ Kendi oyununa dönüldü · YZ skoru',
    en: '↩️ Back to your game · AI score',
  },
  // YZ: canlı pozisyon göstergesi
  'ai.position': { tr: 'Pozisyon', en: 'Position' },
  'ai.health.good': { tr: 'İyi', en: 'Good' },
  'ai.health.risky': { tr: 'Riskli', en: 'Risky' },
  'ai.health.danger': { tr: 'Tehlikeli', en: 'Dangerous' },
  // YZ: hamle kalitesi
  'ai.rate.best': { tr: '✨ Mükemmel hamle', en: '✨ Perfect move' },
  'ai.rate.good': { tr: '👍 İyi hamle', en: '👍 Good move' },
  'ai.rate.inaccurate': { tr: '⚠️ Daha iyisi vardı', en: '⚠️ There was better' },
  'ai.accuracy': { tr: 'Doğruluk', en: 'Accuracy' },

  'assist.suggestion': { tr: 'Önerilen hamle', en: 'Suggested move' },
  'assist.ask': { tr: '💡 Öneri', en: '💡 Hint' },
  'assist.none': { tr: 'Öneri hakkın bitti', en: 'No hints left' },
  'assist.warning': { tr: 'Tahta doluyor, dikkatli oyna!', en: 'Board is filling up, play carefully!' },
  'set.theme': { tr: '🎨 TEMA', en: '🎨 THEME' },
  'set.account': { tr: '👤 HESAP', en: '👤 ACCOUNT' },
  'set.moreThemes': { tr: "Daha fazla tema 🛒 Mağaza'da", en: 'More themes in the 🛒 Store' },
  'set.lang': { tr: '🌐 DİL / LANGUAGE', en: '🌐 LANGUAGE / DİL' },
  'set.credit': {
    tr: '🎵 "Calm Mind – Chill Lofi Beat" — FASSounds · Pixabay · Ücretsiz lisans',
    en: '🎵 "Calm Mind – Chill Lofi Beat" — FASSounds · Pixabay · Free license',
  },

  // Mağaza
  'store.title': { tr: '🛒 Mağaza', en: '🛒 Store' },
  'store.note': {
    tr: 'Altınlarını güçlere ve temalara harca.',
    en: 'Spend your gold on powers and themes.',
  },
  'store.tabThemes': { tr: '🎨 Temalar', en: '🎨 Themes' },
  'store.tabPowers': { tr: '⚡ Güçler', en: '⚡ Powers' },
  // Oyun içi yan paneldeki "Güçler" bölüm başlığı
  'hud.powers': { tr: 'Güçlerin', en: 'Your powers' },
  'store.tabAch': { tr: '🏅 Başarımlar', en: '🏅 Achievements' },
  'store.used': { tr: '✓ Kullanımda', en: '✓ In use' },
  'store.select': { tr: 'Seç', en: 'Select' },
  'store.unlocked': { tr: '✓ Açıldı', en: '✓ Unlocked' },

  // Profil
  'prof.claimDaily': { tr: '🎁 Günlük Ödülü Al', en: '🎁 Claim Daily Reward' },
  'prof.dailyDone': {
    tr: '✓ Günlük ödül alındı — yarın tekrar gel!',
    en: '✓ Daily reward claimed — come back tomorrow!',
  },
  'prof.games': { tr: 'OYUN', en: 'GAMES' },
  'prof.winrate': { tr: 'KAZANMA', en: 'WIN RATE' },
  'prof.bestTile': { tr: 'EN İYİ KARE', en: 'BEST TILE' },
  'prof.streak': { tr: 'SERİ', en: 'STREAK' },
  'prof.bestStreak': { tr: 'EN İYİ SERİ', en: 'BEST STREAK' },
  'prof.totalMoves': { tr: 'TOPLAM HAMLE', en: 'TOTAL MOVES' },
  'prof.bestLevel': { tr: 'EN İYİ SEVİYE', en: 'BEST LEVEL' },
  'prof.totalGold': { tr: 'TOPLAM ALTIN', en: 'TOTAL GOLD' },
  // Ünvan (hesabın genel ilerlemesi — oyun içi "Seviye"den ayrı)
  'prof.points': { tr: 'puan', en: 'points' },
  'prof.pointsLeft': { tr: 'puan kaldı', en: 'points to go' },
  'prof.maxRank': { tr: '🎉 En yüksek ünvan!', en: '🎉 Highest rank!' },
  'prof.changeAvatar': { tr: 'Avatarı değiştir', en: 'Change avatar' },
  'prof.seeAch': { tr: '🏅 Başarımları Gör', en: '🏅 View Achievements' },
  'prof.achievements': { tr: '🏅 Başarımlar', en: '🏅 Achievements' },
  'ach.note': {
    tr: 'Hedefleri tamamla, altın kazan. Kilitli olanlarda ne kadar yaklaştığını görebilirsin.',
    en: 'Complete goals to earn gold. Locked ones show how close you are.',
  },

  // Navigasyon / erişilebilirlik
  'nav.missions': { tr: 'Görevler', en: 'Missions' },
  'nav.store': { tr: 'Mağaza', en: 'Store' },
  'nav.settings': { tr: 'Ayarlar', en: 'Settings' },
  'nav.profile': { tr: 'Profil', en: 'Profile' },
  'nav.home': { tr: 'Ana Ekran', en: 'Home' },
  'prof.nameLabel': { tr: 'Oyuncu adı', en: 'Player name' },
  'prof.loginForName': {
    tr: 'Adın için giriş yap (kayıt olduğun kullanıcı adı)',
    en: 'Log in for your name (your registered username)',
  },
  'hud.totalGold': { tr: 'Toplam altın', en: 'Total gold' },

  // Görevler
  'mis.title': { tr: '🎯 Görevler', en: '🎯 Missions' },
  'mis.note': {
    tr: 'Görevleri tamamla, altın kazan. Günlük her gün, haftalık her hafta yenilenir.',
    en: 'Complete missions, earn gold. Daily resets each day, weekly each week.',
  },
  'mis.daily': { tr: '📅 Günlük', en: '📅 Daily' },
  'mis.weekly': { tr: '🗓️ Haftalık', en: '🗓️ Weekly' },

  // Hesap (giriş / kayıt)
  'auth.title': { tr: '👤 Hesap', en: '👤 Account' },
  'auth.note': {
    tr: 'Giriş yap: ilerlemen buluta kaydedilir, başka cihazdan devam edebilirsin. Arkadaşlar ve çok oyunculu için gerekli.',
    en: 'Sign in: your progress is saved to the cloud and syncs across devices. Required for friends and multiplayer.',
  },
  'auth.username': { tr: 'Kullanıcı adı', en: 'Username' },
  'auth.email': { tr: 'E-posta', en: 'Email' },
  'auth.password': { tr: 'Şifre', en: 'Password' },
  'auth.login': { tr: 'Giriş Yap', en: 'Log In' },
  'auth.register': { tr: 'Kayıt Ol', en: 'Sign Up' },
  'auth.logout': { tr: 'Çıkış Yap', en: 'Log Out' },
  'auth.haveAccount': { tr: 'Zaten hesabın var mı? Giriş yap', en: 'Already have an account? Log in' },
  'auth.noAccount': { tr: 'Hesabın yok mu? Kayıt ol', en: "Don't have an account? Sign up" },
  'auth.loggedInAs': { tr: 'Giriş yapıldı:', en: 'Signed in as:' },
  'auth.signInCta': { tr: '☁️ Giriş yap / Kayıt ol', en: '☁️ Log in / Sign up' },
  'auth.working': { tr: 'Lütfen bekle…', en: 'Please wait…' },
  'auth.synced': { tr: '☁️ İlerleme buluta kaydediliyor', en: '☁️ Progress syncing to cloud' },
  // Hata mesajları (backend error kodları)
  'auth.err.invalid_username': {
    tr: 'Kullanıcı adı 2-20 karakter olmalı (harf, rakam, . _ -).',
    en: 'Username must be 2-20 characters (letters, digits, . _ -).',
  },
  'auth.err.weak_password': { tr: 'Şifre en az 6 karakter olmalı.', en: 'Password must be at least 6 characters.' },
  'auth.err.invalid_email': { tr: 'Geçerli bir e-posta gir.', en: 'Enter a valid email.' },
  'auth.err.username_taken': { tr: 'Bu kullanıcı adı alınmış.', en: 'That username is taken.' },
  'auth.err.bad_credentials': { tr: 'Kullanıcı adı veya şifre hatalı.', en: 'Wrong username or password.' },
  'auth.err.network': { tr: 'Bağlantı hatası. Tekrar dene.', en: 'Connection error. Try again.' },
  'auth.err.too_many_attempts': {
    tr: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar dene.',
    en: 'Too many attempts. Please try again in a few minutes.',
  },
  'auth.err.invalid_data': { tr: 'Kayıt verisi geçersiz.', en: 'Invalid save data.' },
  'auth.err.payload_too_large': { tr: 'Gönderilen veri çok büyük.', en: 'The data sent is too large.' },
  'auth.err.server_error': { tr: 'Sunucu hatası. Tekrar dene.', en: 'Server error. Try again.' },
  'auth.err.busy': { tr: 'Sunucu meşgul. Tekrar dene.', en: 'Server busy. Try again.' },
  'auth.err.error': { tr: 'Bir hata oluştu.', en: 'Something went wrong.' },

  // Arkadaşlar
  'fr.title': { tr: '👥 Arkadaşlar', en: '👥 Friends' },
  'nav.friends': { tr: 'Arkadaşlar', en: 'Friends' },
  'fr.loginNeeded': {
    tr: 'Arkadaş eklemek için giriş yapmalısın.',
    en: 'You need to sign in to add friends.',
  },
  'fr.loginCta': { tr: '☁️ Giriş yap / Kayıt ol', en: '☁️ Log in / Sign up' },
  'fr.searchPlaceholder': { tr: 'Kullanıcı adı ara…', en: 'Search username…' },
  'fr.searching': { tr: 'Aranıyor…', en: 'Searching…' },
  'fr.noResults': { tr: 'Sonuç yok', en: 'No results' },
  'fr.add': { tr: '+ Ekle', en: '+ Add' },
  'fr.requested': { tr: 'İstendi', en: 'Requested' },
  'fr.incoming': { tr: 'Gelen İstekler', en: 'Incoming Requests' },
  'fr.outgoing': { tr: 'Gönderilen İstekler', en: 'Sent Requests' },
  'fr.myFriends': { tr: 'Arkadaşların', en: 'Your Friends' },
  'fr.accept': { tr: 'Kabul', en: 'Accept' },
  'fr.decline': { tr: 'Reddet', en: 'Decline' },
  'fr.remove': { tr: 'Çıkar', en: 'Remove' },
  'fr.chat': { tr: '💬 Sohbet', en: '💬 Chat' },
  'fr.pending': { tr: 'bekliyor', en: 'pending' },
  'fr.empty': {
    tr: 'Henüz arkadaşın yok. Yukarıdan kullanıcı ara ve ekle!',
    en: 'No friends yet. Search above and add someone!',
  },
  'fr.best': { tr: 'En iyi', en: 'Best' },
  'fr.lvl': { tr: 'Sv.', en: 'Lv.' },
  'fr.err.already_friends': { tr: 'Zaten arkadaşsınız.', en: 'Already friends.' },
  'fr.err.already_requested': { tr: 'İstek zaten gönderildi.', en: 'Request already sent.' },
  'fr.err.cannot_add_self': { tr: 'Kendini ekleyemezsin.', en: "You can't add yourself." },
  'fr.err.user_not_found': { tr: 'Kullanıcı bulunamadı.', en: 'User not found.' },
  'fr.err.network': { tr: 'Bağlantı hatası.', en: 'Connection error.' },
  'fr.err.request_not_found': { tr: 'İstek bulunamadı.', en: 'Request not found.' },
  'fr.err.missing_id': { tr: 'Kullanıcı seçilmedi.', en: 'No user selected.' },
  'fr.err.unauthorized': {
    tr: 'Oturumun sona ermiş, tekrar giriş yap.',
    en: 'Your session expired, please sign in again.',
  },
  'fr.err.error': { tr: 'Bir hata oluştu.', en: 'Something went wrong.' },

  // Sohbet
  'chat.title': { tr: 'Sohbet', en: 'Chat' },
  'chat.back': { tr: '← Geri', en: '← Back' },
  'chat.placeholder': { tr: 'Mesaj yaz…', en: 'Type a message…' },
  'chat.send': { tr: 'Gönder', en: 'Send' },
  'chat.empty': {
    tr: 'Henüz mesaj yok. İlk mesajı sen gönder! 👋',
    en: 'No messages yet. Send the first one! 👋',
  },
  'chat.emoji': { tr: 'Emoji ekle', en: 'Add emoji' },

  // Çok oyunculu
  'nav.multiplayer': { tr: 'Çok Oyunculu', en: 'Multiplayer' },
  'mp.title': { tr: '🏁 Çok Oyunculu Yarış', en: '🏁 Multiplayer Race' },
  'mp.loginNeeded': {
    tr: 'Yarışa katılmak için giriş yapmalısın.',
    en: 'You need to sign in to join a race.',
  },
  'mp.intro': {
    tr: 'Oda kur ve kodu arkadaşlarınla paylaş, ya da bir kodla katıl. Herkes aynı taşlarla yarışır — en yüksek skor kazanır!',
    en: 'Create a room and share the code, or join with a code. Everyone races with the same tiles — highest score wins!',
  },
  'mp.create': { tr: '➕ Oda Kur', en: '➕ Create Room' },
  'mp.joinLabel': { tr: 'Kodla Katıl', en: 'Join with Code' },
  'mp.codePlaceholder': { tr: 'Oda kodu (örn. AB12)', en: 'Room code (e.g. AB12)' },
  'mp.join': { tr: 'Katıl', en: 'Join' },
  'mp.duration': { tr: 'Süre', en: 'Duration' },
  'mp.min2': { tr: '2 dk', en: '2 min' },
  'mp.min3': { tr: '3 dk', en: '3 min' },
  'mp.min5': { tr: '5 dk', en: '5 min' },
  'mp.roomCode': { tr: 'Oda Kodu', en: 'Room Code' },
  'mp.share': { tr: 'Kodu arkadaşlarınla paylaş', en: 'Share the code with friends' },
  'mp.copy': { tr: '📋 Kopyala', en: '📋 Copy' },
  'mp.copied': { tr: '✓ Kopyalandı', en: '✓ Copied' },
  'mp.players': { tr: 'Oyuncular', en: 'Players' },
  'mp.host': { tr: 'kurucu', en: 'host' },
  'mp.waiting': { tr: 'Kurucunun başlatması bekleniyor…', en: 'Waiting for host to start…' },
  'mp.addBot': { tr: '🤖 Bot Ekle', en: '🤖 Add Bot' },
  'mp.botEasy': { tr: 'Kolay', en: 'Easy' },
  'mp.botMedium': { tr: 'Orta', en: 'Medium' },
  'mp.botExpert': { tr: 'Uzman', en: 'Expert' },
  'mp.startRace': { tr: '🏁 Yarışı Başlat', en: '🏁 Start Race' },
  'mp.needTwo': {
    tr: 'Başlatmak için en az 2 oyuncu gerekir.',
    en: 'Need at least 2 players to start.',
  },
  'mp.leave': { tr: 'Odadan Ayrıl', en: 'Leave Room' },
  'mp.leaderboard': { tr: '🏁 Canlı Sıralama', en: '🏁 Live Standings' },
  'mp.finished': { tr: 'Yarış Bitti!', en: 'Race Over!' },
  'mp.winner': { tr: '🏆 Kazanan:', en: '🏆 Winner:' },
  'mp.you': { tr: '(sen)', en: '(you)' },
  'mp.done': { tr: '✓ bitti', en: '✓ done' },
  'mp.backToLobby': { tr: 'Panele Dön', en: 'Back to Panel' },
  'mp.err.room_not_found': { tr: 'Oda bulunamadı.', en: 'Room not found.' },
  'mp.err.already_started': { tr: 'Yarış çoktan başladı.', en: 'The race already started.' },
  'mp.err.not_host': { tr: 'Yalnızca kurucu başlatabilir.', en: 'Only the host can start.' },
  'mp.err.room_closed': { tr: 'Oda kapandı (kurucu ayrıldı).', en: 'Room closed (host left).' },
  'mp.err.network': { tr: 'Bağlantı hatası.', en: 'Connection error.' },
  'mp.err.unauthorized': {
    tr: 'Oturumun sona ermiş, tekrar giriş yap.',
    en: 'Your session expired, please sign in again.',
  },
  'mp.err.room_full': { tr: 'Oda dolu.', en: 'The room is full.' },
  'mp.err.invalid_score': { tr: 'Geçersiz skor.', en: 'Invalid score.' },
  'mp.err.error': { tr: 'Bir hata oluştu.', en: 'Something went wrong.' },

  // Yapay zekâ (koç + analiz)
  'nav.coach': { tr: 'YZ Koç', en: 'AI Coach' },
  'coach.title': { tr: '🧠 YZ Koç', en: '🧠 AI Coach' },
  'coach.note': {
    tr: '2048 stratejisi sor, yapay zekâ sana yardımcı olsun.',
    en: 'Ask about 2048 strategy — the AI will help you.',
  },
  'coach.placeholder': { tr: 'Bir şey sor…', en: 'Ask something…' },
  'coach.send': { tr: 'Sor', en: 'Ask' },
  'coach.thinking': { tr: 'Düşünüyor…', en: 'Thinking…' },
  'coach.loginNeeded': {
    tr: 'YZ koçu kullanmak için giriş yapmalısın.',
    en: 'You need to sign in to use the AI coach.',
  },
  'coach.empty': {
    tr: 'Merhaba! 2048’de nasıl daha iyi olurum diye sorabilirsin. 👇',
    en: 'Hi! Ask me how to get better at 2048. 👇',
  },
  'coach.q1': { tr: '2048’e nasıl ulaşırım?', en: 'How do I reach 2048?' },
  'coach.q2': { tr: 'En iyi strateji nedir?', en: "What's the best strategy?" },
  'coach.q3': { tr: 'Sık yapılan hatalar neler?', en: 'What are common mistakes?' },
  'ov.analyze': { tr: '🔍 YZ Analizi', en: '🔍 AI Analysis' },
  'ov.analyzing': { tr: 'Analiz ediliyor…', en: 'Analyzing…' },
  'ai.err.ai_unavailable': {
    tr: 'YZ şu an kullanılamıyor (sunucuda API anahtarı ayarlı değil).',
    en: 'AI is currently unavailable (no API key on the server).',
  },
  'ai.err.unauthorized': {
    tr: 'Bunun için giriş yapmalısın.',
    en: 'You need to sign in for this.',
  },
  'ai.err.network': { tr: 'Bağlantı hatası.', en: 'Connection error.' },
  'ai.err.error': { tr: 'YZ yanıt veremedi, tekrar dene.', en: 'AI could not respond, try again.' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  /** Aktif dil. */
  readonly lang = signal<Lang>(loadLang());

  constructor() {
    this.applyHtmlLang(this.lang());
  }

  /** Statik metin (anahtarla). {n} gibi yer tutucular params ile doldurulur. */
  t(key: string, params?: Record<string, string | number>): string {
    const entry = DICT[key];
    let str = entry ? entry[this.lang()] : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  /** Model verisi için: dile göre TR ya da EN metni seç. */
  L(tr: string, en: string): string {
    return this.lang() === 'en' ? en : tr;
  }

  /** Dili ayarla (kalıcı). */
  set(lang: Lang): void {
    this.lang.set(lang);
    saveLang(lang);
    this.applyHtmlLang(lang);
  }

  private applyHtmlLang(lang: Lang): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang);
    }
  }
}

function loadLang(): Lang {
  try {
    const saved = localStorage?.getItem(LANG_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
    // Tarayıcı dili İngilizce ise EN başlat
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) {
      return 'en';
    }
  } catch {
    /* varsayılan */
  }
  return 'tr';
}

function saveLang(lang: Lang): void {
  try {
    localStorage?.setItem(LANG_KEY, lang);
  } catch {
    /* yoksay */
  }
}
