import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';

describe('GameService — ay sonu şampiyonluk ödülü', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('ödül altın ve güçleri envantere ekler', () => {
    const goldBefore = service.gold();
    const bombBefore = service.powers().bomb;
    service.grantChampionPrize(2000, {
      time: 3,
      bomb: 3,
      shuffle: 3,
      undo: 3,
      hint: 3,
    });
    expect(service.gold()).toBe(goldBefore + 2000);
    expect(service.powers().bomb).toBe(bombBefore + 3);
    expect(service.powers().hint).toBe(3);
  });

  it('şampiyonluk sayacı artar ve kalıcı olur', () => {
    expect(service.championships()).toBe(0);
    service.grantChampionPrize(100, {});
    expect(service.championships()).toBe(1);
    expect(localStorage.getItem('game2048.championships')).toBe('1');
    service.grantChampionPrize(100, {});
    expect(service.championships()).toBe(2);
  });

  it('bilinmeyen güç adları yok sayılır (bozuk veri kırmaz)', () => {
    const before = JSON.stringify(service.powers());
    service.grantChampionPrize(0, { uydurma: 5, bomb: 0 } as never);
    expect(JSON.stringify(service.powers())).toBe(before);
  });

  it('şampiyonluk hesap anlık görüntüsüne girer ve geri yüklenir', () => {
    service.grantChampionPrize(0, {});
    service.grantChampionPrize(0, {});
    const snap = service.accountSnapshot();
    expect(snap['championships']).toBe(2);

    // Başka cihazda sıfırdan başla → hesaptan geri gelir
    service.championships.set(0);
    service.applyAccountSnapshot(snap);
    expect(service.championships()).toBe(2);
  });

  it('ödül oyuncunun kendi rekorunu SIFIRLAMAZ', () => {
    service.bestScore.set(9999);
    service.grantChampionPrize(2000, { bomb: 3 });
    expect(service.bestScore()).toBe(9999); // aylık yarış ayrı, rekor ayrı
  });
});
