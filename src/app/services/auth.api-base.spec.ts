import { API_BASE, apiBaseFor } from './auth.service';

describe('API_BASE — same-origin (HTTPS-hazır) / dev mutlak', () => {
  it('DAĞITIM (domain): same-origin — sayfa HTTPS ise API de HTTPS (mixed-content yok)', () => {
    expect(apiBaseFor('2048.aicirkit.com', 'https://2048.aicirkit.com')).toBe(
      'https://2048.aicirkit.com/emre/2048/api',
    );
  });

  it('DAĞITIM (IP, HTTP): same-origin http', () => {
    expect(apiBaseFor('34.158.136.9', 'http://34.158.136.9')).toBe(
      'http://34.158.136.9/emre/2048/api',
    );
  });

  it('YEREL geliştirme (localhost/127.0.0.1): canlı backend’e MUTLAK', () => {
    expect(apiBaseFor('localhost', 'http://localhost:4200')).toBe(
      'http://34.158.136.9/emre/2048/api',
    );
    expect(apiBaseFor('127.0.0.1', 'http://127.0.0.1:4200')).toBe(
      'http://34.158.136.9/emre/2048/api',
    );
  });

  it('test ortamında (jsdom = localhost) API_BASE mutlak dev adresidir', () => {
    // jsdom location.hostname === 'localhost' → dev dalı.
    expect(API_BASE).toBe('http://34.158.136.9/emre/2048/api');
  });
});
