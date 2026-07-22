import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { Direction, GameMode } from '../models/tile.model';

describe('GameService — hamle kalitesi ve doğruluk', () => {
  let service: GameService;

  const playSome = (n: number) => {
    const dirs = [Direction.Up, Direction.Left, Direction.Down, Direction.Right];
    for (let i = 0; i < n; i++) service.move(dirs[i % 4]);
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('asistan kapalıyken hamle değerlendirilmez (boşuna hesap yok)', () => {
    service.setAssistant(false);
    service.startMode(GameMode.Classic);
    playSome(8);
    expect(service.ratedMoves()).toBe(0);
    expect(service.lastMoveReview()).toBeNull();
  });

  it('asistan açıkken her geçerli hamle değerlendirilir', () => {
    service.setAssistant(true);
    service.startMode(GameMode.Classic);
    playSome(8);
    expect(service.ratedMoves()).toBeGreaterThan(0);
    expect(service.lastMoveReview()).not.toBeNull();
  });

  it('sayaçların toplamı değerlendirilen hamle sayısına eşittir', () => {
    service.setAssistant(true);
    service.startMode(GameMode.Classic);
    playSome(12);
    const r = service.moveRatings();
    expect(r.best + r.good + r.inaccurate).toBe(service.ratedMoves());
  });

  it('doğruluk 0-100 aralığındadır', () => {
    service.setAssistant(true);
    service.startMode(GameMode.Classic);
    playSome(15);
    expect(service.accuracy()).toBeGreaterThanOrEqual(0);
    expect(service.accuracy()).toBeLessThanOrEqual(100);
  });

  it('yeni oyun doğruluk sayaçlarını sıfırlar', () => {
    service.setAssistant(true);
    service.startMode(GameMode.Classic);
    playSome(10);
    expect(service.ratedMoves()).toBeGreaterThan(0);

    service.startMode(GameMode.Classic);
    expect(service.ratedMoves()).toBe(0);
    expect(service.lastMoveReview()).toBeNull();
    expect(service.accuracy()).toBe(100); // hamle yokken tam sayılır
  });

  it('YZ gösterimi doğruluğu kirletmez', () => {
    service.setAssistant(true);
    service.startMode(GameMode.Classic);
    playSome(6);
    const before = service.ratedMoves();

    service.startAutoplay('expert');
    playSome(6); // gösterim sırasındaki hamleler
    expect(service.ratedMoves()).toBe(before); // sayaç artmadı

    service.stopAutoplay();
    expect(service.ratedMoves()).toBe(before);
  });

  it('pozisyon sağlığı tahtayla birlikte güncellenir', () => {
    service.startMode(GameMode.Classic);
    const fresh = service.health();
    expect(fresh.level).toBe('good'); // yeni tahta = 2 taş, bol boşluk
    expect(fresh.score).toBeGreaterThanOrEqual(0);
    expect(fresh.score).toBeLessThanOrEqual(100);
  });

  it('asistan tercihi kalıcıdır', () => {
    service.setAssistant(true);
    expect(localStorage.getItem('game2048.assistant')).toBe('1');
    service.setAssistant(false);
    expect(localStorage.getItem('game2048.assistant')).toBe('0');
  });
});
