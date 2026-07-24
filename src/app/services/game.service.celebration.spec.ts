import { TestBed } from '@angular/core/testing';
import { GameService } from './game.service';
import { GameMode, GameStatus } from '../models/tile.model';

describe('GameService — kutlama olayları', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameService);
  });

  afterEach(() => service.reset());

  it('yeni oyunda kutlama olayı yoktur', () => {
    service.startMode(GameMode.Classic);
    expect(service.celebration()).toBeNull();
  });

  it('başarım açılınca kutlama tetiklenir', () => {
    service.startMode(GameMode.Classic);
    // "Bombacı" başarımının koşulunu sağla
    service.powers.set({ ...service.powers(), bomb: 1 });
    service.usePower('bomb');
    const t = service.tiles()[0];
    service.removeTileAt(t.row, t.col);

    const c = service.celebration();
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('achievement');
  });

  it('YZ oynarken kutlama TETİKLENMEZ', () => {
    service.startMode(GameMode.Classic);
    service.startAutoplay('expert');
    // YZ destekli oyunda başarım koşulu sağlansa bile kutlama olmaz
    service.powers.set({ ...service.powers(), bomb: 1 });
    service.usePower('bomb');
    const t = service.tiles()[0];
    service.removeTileAt(t.row, t.col);
    expect(service.celebration()).toBeNull();
  });

  it('her kutlama artan bir id taşır (aynı olay iki kez oynatılmaz)', () => {
    service.startMode(GameMode.Classic);
    service.powers.set({ ...service.powers(), bomb: 1 });
    service.usePower('bomb');
    const t = service.tiles()[0];
    service.removeTileAt(t.row, t.col);
    const first = service.celebration()!.id;

    // İkinci bir başarım aç (10 oyun) → yeni id
    service.gamesPlayed.set(10);
    service.status.set(GameStatus.Lost);
    service['checkAchievements']();
    const second = service.celebration()!.id;
    expect(second).toBeGreaterThan(first);
  });
});
