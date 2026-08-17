import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ModerationService } from './moderation.service';
import { AuthService } from './auth.service';

/**
 * ModerationService: `/moderation/notices` yanıtını sinyallere döker,
 * en güncel kapatılmamış bildirimi `latest` ile verir, `dismiss` kalıcı gizler.
 * AuthService taklit edilir; fetch global olarak mock'lanır.
 */
describe('ModerationService — kullanıcı moderasyon bildirimleri', () => {
  const loggedIn = signal(true);
  const authStub = {
    isLoggedIn: loggedIn,
    authHeaders: () => (loggedIn() ? { Authorization: 'Bearer test' } : null),
  };

  let service: ModerationService;
  let fetchResult: unknown;

  const makeService = () => {
    TestBed.configureTestingModule({
      providers: [ModerationService, { provide: AuthService, useValue: authStub }],
    });
    return TestBed.inject(ModerationService);
  };

  beforeEach(() => {
    localStorage.clear();
    loggedIn.set(true);
    fetchResult = { notices: [], muted_until: 0, suspended: false };
    globalThis.fetch = ((..._args: unknown[]) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(fetchResult),
      })) as unknown as typeof fetch;
    TestBed.resetTestingModule();
    service = makeService();
  });

  it('bildirimleri çeker ve en güncel olanı latest ile verir', async () => {
    fetchResult = {
      notices: [
        { id: 1, action: 'warn', reason: 'küfür', until: 0, created: 100 },
        { id: 2, action: 'mute', reason: 'spam', until: 0, created: 200 },
      ],
      muted_until: 0,
      suspended: false,
    };
    await service.refresh();
    expect(service.notices().length).toBe(2);
    expect(service.latest()?.id).toBe(2); // en yeni created
  });

  it('dismiss edilen bildirim latest’te bir daha görünmez (kalıcı)', async () => {
    fetchResult = {
      notices: [{ id: 7, action: 'warn', reason: 'test', until: 0, created: 100 }],
      muted_until: 0,
      suspended: false,
    };
    await service.refresh();
    expect(service.latest()?.id).toBe(7);
    service.dismiss(7);
    expect(service.latest()).toBeNull();
    // kalıcı: yeni servis örneği de gizli tutmalı (localStorage)
    TestBed.resetTestingModule();
    const fresh = makeService();
    await fresh.refresh();
    expect(fresh.latest()).toBeNull();
  });

  it('isMuted, gelecekteki muted_until için doğrudur', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    fetchResult = { notices: [], muted_until: future, suspended: false };
    await service.refresh();
    expect(service.isMuted()).toBe(true);
    expect(service.mutedUntil()).toBe(future);
  });

  it('geçmiş muted_until için isMuted yanlıştır', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    fetchResult = { notices: [], muted_until: past, suspended: false };
    await service.refresh();
    expect(service.isMuted()).toBe(false);
  });
});
