import { API_BASE, apiBaseFor } from './auth.service';

describe('API_BASE — same-origin (HTTPS-hazır) / dev mutlak', () => {
  it('DAĞITIM (alan adı kökü): same-origin /api — sayfa HTTPS ise API de HTTPS', () => {
    expect(apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com')).toBe(
      'https://2048.aicirkit.com/api',
    );
  });

  it('DAĞITIM: API her zaman kökte same-origin (/api), alt yol YOK', () => {
    expect(apiBaseFor('example.com', 'https://example.com')).toBe('https://example.com/api');
  });

  it('YEREL geliştirme (localhost/127.0.0.1): canlı backend’e MUTLAK (alan adı, HTTPS)', () => {
    expect(apiBaseFor('localhost', 'http://localhost:4200')).toBe('https://2048.aicirkit.com/api');
    expect(apiBaseFor('127.0.0.1', 'http://127.0.0.1:4200')).toBe('https://2048.aicirkit.com/api');
  });

  it('kodda ESKİ adres (IP / alt yol) kalmadı — sonuçlar temiz', () => {
    for (const r of [
      apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com'),
      apiBaseFor('localhost', 'http://localhost:4200'),
      API_BASE,
    ]) {
      expect(r).not.toContain('34.158.136.9');
      expect(r).not.toContain('/emre/2048');
    }
  });

  it('test ortamında (jsdom = localhost) API_BASE alan adı HTTPS dev adresidir', () => {
    expect(API_BASE).toBe('https://2048.aicirkit.com/api');
  });
});
