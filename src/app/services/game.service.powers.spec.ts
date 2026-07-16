import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameStatus } from '../models/tile.model';
import { powerDef } from '../models/power.model';

describe('GameService — mağaza ve güçler', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('başlangıçta tüm güçler 0', () => {
    const p = service.powers();
    expect(p.time).toBe(0);
    expect(p.bomb).toBe(0);
    expect(p.shuffle).toBe(0);
    expect(p.undo).toBe(0);
    expect(p.hint).toBe(0);
  });

  it('yeterli altın yoksa satın alınamaz', () => {
    service.gold.set(10);
    expect(service.buyPower('bomb')).toBe(false); // bomba 40
    expect(service.powers().bomb).toBe(0);
    expect(service.gold()).toBe(10);
  });

  it('satın alma altını düşürür ve envantere ekler (kalıcı)', () => {
    service.gold.set(100);
    expect(service.buyPower('bomb')).toBe(true);
    expect(service.gold()).toBe(100 - powerDef('bomb').price); // 60
    expect(service.powers().bomb).toBe(1);
    expect(localStorage.getItem('game2048.gold')).toBe('60');

    // Yeni servis envanteri geri yükler
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const s2 = TestBed.inject(GameService);
    expect(s2.powers().bomb).toBe(1);
    s2.reset();
  });

  it('+30 saniye gücü kalan süreyi artırır (seviye modu)', () => {
    service.gold.set(100);
    service.buyPower('time');
    service.startLevelMode();
    const before = service.remainingSeconds();

    expect(service.usePower('time')).toBe(true);
    expect(service.remainingSeconds()).toBe(before + 30);
    expect(service.powers().time).toBe(0); // tüketildi
  });

  it('+30 saniye klasik modda çalışmaz (güç harcanmaz)', () => {
    service.gold.set(100);
    service.buyPower('time');
    service.startGame(); // klasik
    expect(service.usePower('time')).toBe(false);
    expect(service.powers().time).toBe(1); // harcanmadı
  });

  it('bomba: mod açılır, kareye dokununca silinir ve güç harcanır', () => {
    service.gold.set(100);
    service.buyPower('bomb');
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 4, row: 1, col: 1 },
    ]);

    expect(service.usePower('bomb')).toBe(true);
    expect(service.bombMode()).toBe(true);
    expect(service.powers().bomb).toBe(1); // henüz harcanmadı

    // (1,1)'deki kareyi sil
    expect(service.removeTileAt(1, 1)).toBe(true);
    expect(service.tiles().length).toBe(1);
    expect(service.tiles()[0].id).toBe(1);
    expect(service.bombMode()).toBe(false);
    expect(service.powers().bomb).toBe(0); // şimdi harcandı
  });

  it('bomba iptal edilince güç harcanmaz', () => {
    service.gold.set(100);
    service.buyPower('bomb');
    service.status.set(GameStatus.Playing);
    service.tiles.set([{ id: 1, value: 2, row: 0, col: 0 }]);
    service.usePower('bomb');

    service.cancelBomb();
    expect(service.bombMode()).toBe(false);
    expect(service.powers().bomb).toBe(1); // korundu
  });

  it('karıştır: kare sayısı korunur, güç harcanır', () => {
    service.gold.set(100);
    service.buyPower('shuffle');
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 4, row: 0, col: 1 },
      { id: 3, value: 8, row: 0, col: 2 },
    ]);

    expect(service.usePower('shuffle')).toBe(true);
    expect(service.tiles().length).toBe(3); // sayı aynı
    // Değerler korunur
    const values = service
      .tiles()
      .map((t) => t.value)
      .sort();
    expect(values).toEqual([2, 4, 8]);
    expect(service.powers().shuffle).toBe(0);
  });

  it('ipucu: geçerli bir yön önerir ve güç harcanır', () => {
    service.gold.set(100);
    service.buyPower('hint');
    service.status.set(GameStatus.Playing);
    service.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);

    expect(service.usePower('hint')).toBe(true);
    expect(service.hintDirection()).not.toBeNull();
    expect([
      Direction.Left,
      Direction.Right,
      Direction.Up,
      Direction.Down,
    ]).toContain(service.hintDirection());
    expect(service.powers().hint).toBe(0);
  });

  it('sahip olunmayan güç kullanılamaz', () => {
    service.status.set(GameStatus.Playing);
    service.tiles.set([{ id: 1, value: 2, row: 0, col: 0 }]);
    expect(service.usePower('shuffle')).toBe(false);
  });

  it('oyun oynanmıyorken güç kullanılamaz', () => {
    service.gold.set(100);
    service.buyPower('shuffle');
    service.status.set(GameStatus.Idle);
    expect(service.usePower('shuffle')).toBe(false);
    expect(service.powers().shuffle).toBe(1); // harcanmadı
  });
});
