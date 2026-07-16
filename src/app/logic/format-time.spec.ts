import { formatTime } from './format-time';

describe('formatTime (süre biçimlendirme)', () => {
  it('0 saniye → 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('saniyeleri iki hane yapar', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(9)).toBe('00:09');
  });

  it('dakika + saniye', () => {
    expect(formatTime(75)).toBe('01:15');
    expect(formatTime(600)).toBe('10:00');
  });

  it('bir saati aşınca saat de ekler', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('ondalık saniyeyi aşağı yuvarlar', () => {
    expect(formatTime(59.9)).toBe('00:59');
  });

  it('negatif değer 00:00 olur', () => {
    expect(formatTime(-5)).toBe('00:00');
  });
});
