import { TestBed } from '@angular/core/testing';
import { BoardComponent } from './board';
import { GameService } from '../../services/game.service';
import { Tile } from '../../models/tile.model';

describe('BoardComponent', () => {
  let game: GameService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardComponent],
    }).compileComponents();
    game = TestBed.inject(GameService);
  });

  function render() {
    const fixture = TestBed.createComponent(BoardComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('16 adet boş zemin hücresi çizmeli', () => {
    const fixture = render();
    const cells = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.cell-bg',
    );
    expect(cells.length).toBe(16);
  });

  it('signal’deki her kare için bir app-tile render etmeli', () => {
    const tiles: Tile[] = [
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 4, row: 1, col: 2 },
      { id: 3, value: 8, row: 3, col: 3 },
    ];
    game.tiles.set(tiles);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const tileEls = el.querySelectorAll('app-tile');
    expect(tileEls.length).toBe(3);
  });

  it('kareler doğru satır/sütun (--row/--col) ile konumlanmalı', () => {
    game.tiles.set([{ id: 1, value: 2, row: 2, col: 3 }]);

    const fixture = render();
    const host = (fixture.nativeElement as HTMLElement).querySelector(
      'app-tile',
    ) as HTMLElement;

    expect(host.style.getPropertyValue('--row').trim()).toBe('2');
    expect(host.style.getPropertyValue('--col').trim()).toBe('3');
  });

  it('farklı değerler farklı renk (data-value) almalı', () => {
    game.tiles.set([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 4, row: 0, col: 1 },
    ]);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.tile[data-value="2"]')).toBeTruthy();
    expect(el.querySelector('.tile[data-value="4"]')).toBeTruthy();
    // Değerler ekranda görünüyor
    expect(el.querySelector('.tile[data-value="2"]')?.textContent?.trim()).toBe(
      '2',
    );
    expect(el.querySelector('.tile[data-value="4"]')?.textContent?.trim()).toBe(
      '4',
    );
  });

  it('yeni kare "is-new" (pop-in) sınıfı almalı', () => {
    game.tiles.set([{ id: 1, value: 2, row: 0, col: 0, isNew: true }]);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.tile.is-new')).toBeTruthy();
  });

  it('birleşen kare "is-merged" (bump) sınıfı almalı', () => {
    game.tiles.set([{ id: 1, value: 4, row: 0, col: 0, merged: true }]);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.tile.is-merged')).toBeTruthy();
  });

  it('kare id’si korunduğunda DOM elemanı aynı kalır (kayma animasyonu)', () => {
    game.tiles.set([{ id: 7, value: 2, row: 0, col: 0 }]);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const before = el.querySelector('app-tile');

    // Aynı id, yeni konum → aynı DOM elemanı, sadece --col değişir
    game.tiles.set([{ id: 7, value: 2, row: 0, col: 3 }]);
    fixture.detectChanges();

    const after = el.querySelector('app-tile') as HTMLElement;
    expect(after).toBe(before); // DOM yeniden oluşturulmadı → transition kayar
    expect(after.style.getPropertyValue('--col').trim()).toBe('3');
  });
});
