import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { SeoService } from './seo.service';
import { I18nService } from './i18n.service';

describe('SeoService — dile göre başlık + paylaşım meta', () => {
  let seo: SeoService;
  let i18n: I18nService;
  let title: Title;
  let meta: Meta;

  beforeEach(() => {
    localStorage.clear();
    try {
      history.replaceState(null, '', '/');
    } catch {
      /* yoksay */
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    seo = TestBed.inject(SeoService);
    i18n = TestBed.inject(I18nService);
    title = TestBed.inject(Title);
    meta = TestBed.inject(Meta);
  });

  it('dil TR → sekme başlığı + açıklama + og:locale Türkçe', async () => {
    i18n.set('tr');
    await i18n.ready();
    seo.refresh();
    expect(title.getTitle()).toBe('2048 — Sayı Birleştirme Bulmacası');
    expect(meta.getTag('name="description"')?.content).toContain('birleştir');
    expect(meta.getTag('property="og:locale"')?.content).toBe('tr_TR');
    expect(meta.getTag('property="og:locale:alternate"')?.content).toBe('en_US');
  });

  it('dil EN → başlık + açıklama + og/twitter İngilizce', async () => {
    i18n.set('en');
    await i18n.ready();
    seo.refresh();
    expect(title.getTitle()).toBe('2048 — Number Merge Puzzle');
    expect(meta.getTag('name="description"')?.content).toContain('merge');
    expect(meta.getTag('property="og:title"')?.content).toBe('2048 — Number Merge Puzzle');
    expect(meta.getTag('property="og:description"')?.content).toContain('2048');
    expect(meta.getTag('property="og:locale"')?.content).toBe('en_US');
    expect(meta.getTag('name="twitter:title"')?.content).toBe('2048 — Number Merge Puzzle');
  });

  it('dil değişimi başlığı ANLIK günceller (TR ↔ EN)', async () => {
    i18n.set('tr');
    await i18n.ready();
    seo.refresh();
    expect(title.getTitle()).toContain('Sayı');
    i18n.set('en');
    await i18n.ready();
    seo.refresh();
    expect(title.getTitle()).toContain('Number');
  });
});
