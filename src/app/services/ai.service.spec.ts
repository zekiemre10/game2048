import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AiService } from './ai.service';
import { GameService } from './game.service';
import { I18nService } from './i18n.service';
import { Direction, GameMode } from '../models/tile.model';

describe('AiService — kişisel koç + oyun özeti', () => {
  let ai: AiService;
  let game: GameService;
  let i18n: I18nService;

  const playSome = (n: number) => {
    const dirs = [Direction.Up, Direction.Left, Direction.Down, Direction.Right];
    for (let i = 0; i < n; i++) game.move(dirs[i % 4]);
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    ai = TestBed.inject(AiService);
    game = TestBed.inject(GameService);
    i18n = TestBed.inject(I18nService);
  });

  it('oyun özeti oyunun gerçek durumunu yansıtır', () => {
    game.setAssistant(true);
    game.startMode(GameMode.Classic);
    playSome(12);

    const s = ai.buildSummary();
    expect(s.mode).toBe('classic');
    expect(s.moves).toBe(game.moves());
    expect(s.score).toBe(game.score());
    expect(s.bestTile).toBe(game.currentBestTile());
    expect(s.lang).toBe(i18n.lang()); // aktif dile göre TR/EN
    expect(s.assistant).toBe(true);
  });

  it('sağlık eğrisi en fazla 24 noktaya seyreltilir (bellek koruması)', () => {
    // Asistan KAPALI: sağlık eğrisi yine dolar (asistana bağlı değil) ama hamle
    // başına pahalı reviewMove çalışmaz → çok sayıda hamle hızlıca oynanabilir.
    game.setAssistant(false);
    game.startMode(GameMode.Classic);
    playSome(40); // çizelge 24'ten uzun; özet eğrisi 24 ile sınırlı olmalı

    const s = ai.buildSummary();
    expect(s.healthCurve.length).toBeGreaterThan(0);
    expect(s.healthCurve.length).toBeLessThanOrEqual(24);
    for (const h of s.healthCurve) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
  });

  it('asistan KAPALIYKEN hatalı hamle listesi boş kalır (kalite asistana bağlı)', () => {
    game.setAssistant(false);
    game.startMode(GameMode.Classic);
    playSome(10);

    const s = ai.buildSummary();
    expect(s.assistant).toBe(false);
    expect(s.inaccurateMoves).toEqual([]);
  });

  it('misafir (giriş yok) → koç yerel şablona düşer (ai:false), ağ isteği yok', async () => {
    // Ağ çağrısı yapılırsa test ortamında hata olurdu; misafir yolu fetch ÇAĞIRMAZ.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    game.setAssistant(true);
    game.startMode(GameMode.Classic);
    playSome(8);

    const result = await ai.coach();
    expect(result.ai).toBe(false);
    expect(result.text.length).toBeGreaterThan(0); // şablon metin dolu
    expect(fetchSpy).not.toHaveBeenCalled(); // misafir → sunucuya gidilmez
  });
});
