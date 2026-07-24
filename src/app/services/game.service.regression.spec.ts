import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameMode, GameStatus } from '../models/tile.model';
import { weekKey } from '../logic/missions';
import { bestMove, simulateMove } from '../logic/ai';

// ============================================================
//  Denetimde bulunan hataların regresyon testleri.
//  Her test, gerçekten yaşanmış bir hatanın geri gelmesini engeller.
// ============================================================

describe('Regresyon — denetimde bulunan hatalar', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  // --- Geri alma ---------------------------------------------

  it('geri alma hamle sayacını da geri sarar (istatistik şişmiyor)', () => {
    service.startMode(GameMode.Classic);
    const before = service.moves();
    // Geçerli bir hamle bulana kadar dene
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    expect(service.moves()).toBe(before + 1);
    expect(service.undo()).toBe(true);
    expect(service.moves()).toBe(before); // eskiden burada +1 kalıyordu
  });

  it('yarışta geri alma yapılamaz (tohumlu taş dizisi geri sarılamaz)', () => {
    service.startRace(12345, 60);
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    expect(service.undo()).toBe(false);
  });

  it('biten oyunu geri alınca sayaç yeniden başlar (sınırsız süre yok)', () => {
    service.startMode(GameMode.TimeAttack);
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    // Oyunu bitmiş gibi göster, sonra geri al
    service.status.set(GameStatus.Lost);
    expect(service.undo()).toBe(true);
    expect(service.status()).toBe(GameStatus.Playing);
    // Geri sayım tekrar kuruldu → kalan süre hâlâ sınırlı
    expect(service.remainingSeconds()).toBeGreaterThan(0);
  });

  // --- YZ ilerleme koruması -----------------------------------

  it('YZ oynadıysa durdurulsa bile rekor yazılmaz', () => {
    service.startMode(GameMode.Classic);
    service.bestScore.set(0);
    // YZ bu oyunda oynadı (durdurulmuş olsa da bayrak kalıcı)
    service.aiAssisted.set(true);
    expect(service.autoplaying()).toBe(false); // YZ şu an oynamıyor
    service.score.set(9999);
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    expect(service.bestScore()).toBe(0); // eskiden 9999+ yazılıyordu
  });

  it('YZ oynadıysa durdurulsa bile görevler ilerlemez', () => {
    service.startMode(GameMode.Classic);
    // Görev listesi oluşsun diye önce insan bir hamle yapsın
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    const before = JSON.stringify(service.dailyMissions());
    service.aiAssisted.set(true); // YZ oynadı, sonra durduruldu
    for (let i = 0; i < 8; i++) {
      const d = [Direction.Up, Direction.Left, Direction.Down, Direction.Right][i % 4];
      service.move(d);
    }
    expect(JSON.stringify(service.dailyMissions())).toBe(before);
  });

  // --- YZ yalnızca gösterim ------------------------------------

  it('YZ durdurulunca oyuncunun kendi tahtası ve skoru geri gelir', () => {
    // Yalnızca anlamlı tahta durumu: konum/değer (animasyon bayrakları
    // geri yüklemede kasıtlı olarak temizlenir, kıyasa dahil edilmez).
    const boardState = () =>
      JSON.stringify(
        service
          .tiles()
          .map((t) => ({ id: t.id, value: t.value, row: t.row, col: t.col }))
          .sort((a, b) => a.id - b.id),
      );

    service.startMode(GameMode.Classic);
    // Oyuncu birkaç hamle yapsın
    for (let i = 0; i < 6; i++) {
      service.move([Direction.Up, Direction.Left, Direction.Down, Direction.Right][i % 4]);
    }
    const myTiles = boardState();
    const myScore = service.score();
    const myMoves = service.moves();

    service.startAutoplay('expert');
    // YZ birkaç hamle oynasın (zamanlayıcıyı beklemeden elle ilerlet)
    for (let i = 0; i < 10; i++) {
      const dir = bestMove(service.toValueGrid(), 'expert');
      if (!dir) break;
      service.move(dir);
    }
    expect(service.score()).toBeGreaterThanOrEqual(myScore);

    service.stopAutoplay();

    expect(boardState()).toBe(myTiles);
    expect(service.score()).toBe(myScore);
    expect(service.moves()).toBe(myMoves);
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('gösterim bitince o oyun artık YZ destekli sayılmaz', () => {
    service.startMode(GameMode.Classic);
    service.startAutoplay('expert');
    const dir = bestMove(service.toValueGrid(), 'expert');
    if (dir) service.move(dir);
    expect(service.aiPlayed()).toBe(true); // gösterim sırasında ilerleme yok

    service.stopAutoplay();
    // YZ'nin oynadığı her şey atıldı → oyuncu avantaj devralmadı
    expect(service.aiPlayed()).toBe(false);
    expect(service.aiAssisted()).toBe(false);
  });

  it('gösterim oyuncunun süresini ve öneri hakkını tüketmez', () => {
    service.startMode(GameMode.TimeAttack);
    service.requestAssistHint(); // bir hak kullan
    const hintsBefore = service.assistHintsLeft();
    const remainingBefore = service.remainingSeconds();

    service.startAutoplay('expert');
    for (let i = 0; i < 5; i++) {
      const dir = bestMove(service.toValueGrid(), 'expert');
      if (!dir) break;
      service.move(dir);
    }
    service.requestAssistHint(); // gösterimde istenirse yok sayılmalı
    service.stopAutoplay();

    expect(service.assistHintsLeft()).toBe(hintsBefore);
    expect(service.remainingSeconds()).toBe(remainingBefore);
  });

  it('gösterim sonrası YZ skoru kısa süre bildirilir', () => {
    service.startMode(GameMode.Classic);
    service.startAutoplay('expert');
    const dir = bestMove(service.toValueGrid(), 'expert');
    if (dir) service.move(dir);
    const aiScore = service.score();
    service.stopAutoplay();
    expect(service.aiDemoResult()).toBe(aiScore);
  });

  it('gösterim durdurulunca taşlarda animasyon bayrağı kalmaz', () => {
    service.startMode(GameMode.Classic);
    // Bir hamle yap → yeni/birleşmiş taş bayrakları oluşabilir
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    service.startAutoplay('expert');
    const dir = bestMove(service.toValueGrid(), 'expert');
    if (dir) service.move(dir);
    service.stopAutoplay();
    // Geri yüklenen taşların hiçbiri isNew/merged taşımamalı (tekrar animasyon yok)
    for (const t of service.tiles()) {
      expect(t.isNew).toBeFalsy();
      expect(t.merged).toBeFalsy();
    }
  });

  it('gösterim geri sayım sayacını dondurur (oyun-sonu ekranı yanıp sönmez)', () => {
    service.startMode(GameMode.TimeAttack);
    service.startAutoplay('expert');
    // Gösterim sırasında YZ oynasa da geri sayım aktif sayaç KURMAMALI:
    // status Playing kalır, süre bitip Lost'a düşmez.
    for (let i = 0; i < 8; i++) {
      const dir = bestMove(service.toValueGrid(), 'expert');
      if (!dir) break;
      service.move(dir);
    }
    expect(service.status()).toBe(GameStatus.Playing);
    service.stopAutoplay();
    expect(service.status()).toBe(GameStatus.Playing);
  });

  it('gösterim sırasında yeni oyun başlarsa eski tahta GERİ GELMEZ', () => {
    service.startMode(GameMode.Classic);
    for (let i = 0; i < 4; i++) {
      service.move([Direction.Up, Direction.Left, Direction.Down, Direction.Right][i % 4]);
    }
    service.startAutoplay('expert');
    const dir = bestMove(service.toValueGrid(), 'expert');
    if (dir) service.move(dir);

    service.startMode(GameMode.Classic); // yeni oyun
    expect(service.autoplaying()).toBe(false);
    expect(service.score()).toBe(0);
    expect(service.moves()).toBe(0);
    expect(service.tiles().length).toBe(2); // taptaze tahta

    // Sonradan durdurma çağrısı eski oyunu diriltmemeli
    service.stopAutoplay();
    expect(service.score()).toBe(0);
    expect(service.tiles().length).toBe(2);
  });

  it('yeni oyun YZ bayrağını temizler', () => {
    service.aiAssisted.set(true);
    service.startMode(GameMode.Classic);
    expect(service.aiAssisted()).toBe(false);
  });

  // --- Güçler --------------------------------------------------

  it('karıştırma oyuncuyu oynanamaz tahtaya kilitlemez', () => {
    service.startMode(GameMode.Classic);
    service.powers.set({ ...service.powers(), shuffle: 50 });
    // Çok sayıda karıştırmada oyun ya oynanabilir kalmalı ya da usulünce bitmeli
    for (let i = 0; i < 30; i++) {
      if (service.status() !== GameStatus.Playing) break;
      service.usePower('shuffle');
      const stuck =
        service.status() === GameStatus.Playing &&
        !([Direction.Up, Direction.Down, Direction.Left, Direction.Right].some(
          (d) => simulateMove(service.toValueGrid(), d).moved,
        ));
      expect(stuck).toBe(false); // "Playing ama hiç hamle yok" olamaz
    }
  });

  it('bombadan sonra geri alma bombalanan kareyi geri getiremez', () => {
    service.startMode(GameMode.Classic);
    for (const d of [Direction.Up, Direction.Left, Direction.Down, Direction.Right]) {
      if (service.move(d)) break;
    }
    service.powers.set({ ...service.powers(), bomb: 1 });
    service.usePower('bomb');
    const target = service.tiles()[0];
    expect(service.removeTileAt(target.row, target.col)).toBe(true);
    expect(service.undo()).toBe(false); // geçmiş temizlendi
  });

  // --- Yarış ---------------------------------------------------

  it('yarışta "Yeni Oyun" yarışı bozmaz', () => {
    service.startRace(777, 60);
    const before = service.mode();
    service.restartCurrent();
    expect(service.mode()).toBe(before);
    expect(service.mode()).toBe(GameMode.Race);
    expect(service.remainingSeconds()).toBeGreaterThan(0); // geri sayım duruyor
  });

  it('currentBestTile tüm zamanların rekorunu değil o tahtayı verir', () => {
    service.startMode(GameMode.Classic);
    service.bestTile.set(2048); // geçmiş rekor
    const max = service.tiles().reduce((m, t) => Math.max(m, t.value), 0);
    expect(service.currentBestTile()).toBe(max);
    expect(service.currentBestTile()).toBeLessThan(2048);
  });

  // --- Görev dönemi --------------------------------------------

  it('weekKey ISO hafta yılını kullanır (yıl sonu çakışması yok)', () => {
    // 30 Ara 2019 ISO'da 2020'nin 1. haftasıdır
    expect(weekKey(new Date(2019, 11, 30))).toBe('2020-W01');
    // 1 Oca 2019 ile aynı anahtarı ÜRETMEMELİ
    expect(weekKey(new Date(2019, 11, 30))).not.toBe(weekKey(new Date(2019, 0, 1)));
    // 1 Oca 2022 ISO'da 2021'in son haftasıdır
    expect(weekKey(new Date(2022, 0, 1))).toBe('2021-W52');
    // ve 26 Ara 2022 ile çakışmamalı (eskiden ikisi de 2022-W52 idi)
    expect(weekKey(new Date(2022, 0, 1))).not.toBe(weekKey(new Date(2022, 11, 26)));
  });

  // --- YZ motoru ------------------------------------------------

  it('bestMove her yöne eşit bütçe verir ve daima geçerli hamle döner', () => {
    const grid = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2, 4],
      [8, 16, 32, 0],
    ];
    for (const level of ['easy', 'medium', 'expert'] as const) {
      const dir = bestMove(grid, level);
      expect(dir).not.toBeNull();
      expect(simulateMove(grid, dir!).moved).toBe(true);
    }
  });
});
