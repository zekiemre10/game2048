import { API_BASE, apiBaseFor } from './auth.service';

describe('API_BASE — base-href göreli (HTTPS-hazır) / dev mutlak', () => {
  it('DAĞITIM (alt yol): base href /emre/2048/ → same-origin …/emre/2048/api', () => {
    expect(apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com/emre/2048/')).toBe(
      'https://2048.aicirkit.com/emre/2048/api',
    );
  });

  it('DAĞITIM (kök): base href / → same-origin …/api (köke taşınınca otomatik)', () => {
    expect(apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com/')).toBe(
      'https://2048.aicirkit.com/api',
    );
  });

  it('DAĞITIM: API sayfayla aynı origin + aynı base yolunda (mixed-content yok)', () => {
    expect(apiBaseFor('example.com', 'https://example.com/app/')).toBe(
      'https://example.com/app/api',
    );
  });

  it('YEREL geliştirme (localhost/127.0.0.1): canlı backend’e MUTLAK (alan adı, HTTPS)', () => {
    expect(apiBaseFor('localhost', 'http://localhost:4200/')).toBe('https://2048.aicirkit.com/api');
    expect(apiBaseFor('127.0.0.1', 'http://127.0.0.1:4200/')).toBe('https://2048.aicirkit.com/api');
  });

  it('kodda gömülü IP adresi kalmadı — sonuçlar temiz', () => {
    for (const r of [
      apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com/emre/2048/'),
      apiBaseFor('localhost', 'http://localhost:4200/'),
      API_BASE,
    ]) {
      expect(r).not.toContain('34.158.136.9');
    }
  });

  it('test ortamında (jsdom = localhost) API_BASE alan adı HTTPS dev adresidir', () => {
    expect(API_BASE).toBe('https://2048.aicirkit.com/api');
  });
});
