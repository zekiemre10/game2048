import { swipeDirection, SWIPE_THRESHOLD } from './swipe';
import { Direction } from '../models/tile.model';

describe('swipeDirection (dokunmatik yön tespiti)', () => {
  it('sağa kaydırma → Right', () => {
    expect(swipeDirection(80, 5)).toBe(Direction.Right);
  });

  it('sola kaydırma → Left', () => {
    expect(swipeDirection(-80, -5)).toBe(Direction.Left);
  });

  it('aşağı kaydırma → Down', () => {
    expect(swipeDirection(5, 80)).toBe(Direction.Down);
  });

  it('yukarı kaydırma → Up', () => {
    expect(swipeDirection(-5, -80)).toBe(Direction.Up);
  });

  it('eşik altındaki küçük dokunuş → null (hamle yok)', () => {
    expect(swipeDirection(10, 10)).toBeNull();
    expect(swipeDirection(SWIPE_THRESHOLD - 1, 0)).toBeNull();
  });

  it('yatay ve dikey yarışırsa büyük eksen kazanır', () => {
    expect(swipeDirection(100, 40)).toBe(Direction.Right); // yatay baskın
    expect(swipeDirection(40, 100)).toBe(Direction.Down); // dikey baskın
  });

  it('tam eşikte hamle sayılır', () => {
    expect(swipeDirection(SWIPE_THRESHOLD, 0)).toBe(Direction.Right);
  });
});
