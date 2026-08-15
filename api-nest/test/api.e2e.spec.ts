import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayGame } from '../src/replay/replay';
import { playBotGame } from '../src/rooms/bot-ai';
import { RateLimitService } from '../src/common/rate-limit.service';

// ============================================================
//  Uçtan uca — NestJS backend'i mongodb-memory-server ile ayağa kaldırır.
//  KABUL KRİTERLERİ: uydurma skor reddi, sunucu-hesaplı skor, sync birleşme,
//  leaderboard sıralaması, OYUN-311 (oda skoru sunucuda doğrulanır).
// ============================================================

let mongod: MongoMemoryServer;
let app: INestApplication;
let rl: RateLimitService;

const REPLAY_FIXTURES = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'server', 'replay_fixtures.json'), 'utf-8'),
);

async function reg(username: string, password = 'secret123', email = `${username}@e.com`) {
  const r = await request(app.getHttpServer()).post('/register').send({ username, password, email });
  return r;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.GAME2048_MONGO_URI = mongod.getUri();
  process.env.GAME2048_DB_NAME = 'game2048_test';
  // AppModule env'i modül init'te okur → önce set edildi.
  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  rl = moduleRef.get(RateLimitService);
  await app.init();
}, 120_000);

// Testler arası hız-sınırı yalıtımı (register 8/IP suite'i tüketmesin).
beforeEach(() => rl?.resetAll());

afterAll(async () => {
  await app?.close();
  await mongod?.stop();
});

describe('health + auth', () => {
  it('GET /health → {ok:true}', async () => {
    const r = await request(app.getHttpServer()).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('register → login → me akışı', async () => {
    const r = await reg('alice');
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user).toMatchObject({ id: expect.any(Number), username: 'alice' });
    expect(r.body.user.email).toBeUndefined(); // email SIZMAZ

    const login = await request(app.getHttpServer()).post('/login').send({ username: 'alice', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const me = await request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('alice');
  });

  it('geçersiz kullanıcı adı / zayıf parola / kötü giriş reddedilir', async () => {
    expect((await request(app.getHttpServer()).post('/register').send({ username: 'a', password: 'secret123', email: 'a@b.com' })).body.error).toBe('invalid_username');
    expect((await request(app.getHttpServer()).post('/register').send({ username: 'validname', password: '123', email: 'a@b.com' })).body.error).toBe('weak_password');
    expect((await request(app.getHttpServer()).post('/login').send({ username: 'alice', password: 'WRONG' })).body.error).toBe('bad_credentials');
    expect((await request(app.getHttpServer()).get('/me')).status).toBe(401);
  });
});

describe('sync — alan bazlı birleşme (kayıpsız)', () => {
  it('MAX rekor + achievements birleşimi + altın uzlaşma', async () => {
    const { body } = await reg('bob');
    const token = body.token;
    const h = { Authorization: `Bearer ${token}` };

    await request(app.getHttpServer()).post('/sync').set(h)
      .send({ data: { bestScore: 1000, achievements: ['a1'], totalGoldEarned: 500, gold: 500 } });
    const r2 = await request(app.getHttpServer()).post('/sync').set(h)
      .send({ data: { bestScore: 800, achievements: ['a2'], totalGoldEarned: 500, gold: 200 } });

    expect(r2.status).toBe(200);
    expect(r2.body.data.bestScore).toBe(1000); // MAX
    expect(r2.body.data.achievements).toEqual(['a1', 'a2']); // birleşim
    // earned=500, spent=max(0, 500-200)=300 → gold=200
    expect(r2.body.data.gold).toBe(200);
    expect(r2.body.data.v).toBe(2);
  });
});

describe('aylık skor — sunucu replay (uydurma skor reddi)', () => {
  it('geçerli transkript kabul; sunucu skoru istemcininkini EZER', async () => {
    const fx = REPLAY_FIXTURES[0];
    const { body } = await reg('carol');
    const h = { Authorization: `Bearer ${body.token}` };
    const r = await request(app.getHttpServer()).post('/monthly/submit').set(h)
      .send({ seed: fx.seed, moves: fx.moves, size: fx.size, score: 999999999 }); // şişirilmiş iddia
    expect(r.status).toBe(200);
    expect(r.body.improved).toBe(true);
    expect(r.body.score).toBe(fx.score); // SUNUCU hesabı, iddia değil
  });

  it('bozuk transkript → 400 invalid_score (yazılmaz)', async () => {
    const { body } = await reg('dave');
    const h = { Authorization: `Bearer ${body.token}` };
    const r = await request(app.getHttpServer()).post('/monthly/submit').set(h)
      .send({ seed: 123, moves: 'ZZZZ', size: 4, score: 5000 }); // geçersiz karakter
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_score');
  });
});

describe('leaderboard sıralaması (monthly)', () => {
  it('skor ↓ sıralı, rank atanır', async () => {
    const fxHigh = REPLAY_FIXTURES.reduce((a: any, b: any) => (b.score > a.score ? b : a));
    const fxLow = REPLAY_FIXTURES.reduce((a: any, b: any) => (b.score < a.score ? b : a));

    const u1 = (await reg('erin')).body;
    const u2 = (await reg('frank')).body;
    await request(app.getHttpServer()).post('/monthly/submit').set({ Authorization: `Bearer ${u1.token}` })
      .send({ seed: fxHigh.seed, moves: fxHigh.moves, size: fxHigh.size });
    await request(app.getHttpServer()).post('/monthly/submit').set({ Authorization: `Bearer ${u2.token}` })
      .send({ seed: fxLow.seed, moves: fxLow.moves, size: fxLow.size });

    const lb = await request(app.getHttpServer()).get('/leaderboard?scope=monthly').set({ Authorization: `Bearer ${u1.token}` });
    expect(lb.status).toBe(200);
    const scores = lb.body.top.map((t: any) => t.bestScore);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(lb.body.top[0].rank).toBe(1);
  });
});

describe('OYUN-311 — oda skoru sunucuda doğrulanır', () => {
  it('geçerli transkript kabul (sunucu skoru); bozuk transkript YAZILMAZ', async () => {
    const host = (await reg('grace')).body;
    const h = { Authorization: `Bearer ${host.token}` };

    const created = await request(app.getHttpServer()).post('/rooms/create').set(h).send({ duration: 120 });
    expect(created.status).toBe(200);
    const code = created.body.room.code;
    const seed = created.body.room.seed;

    await request(app.getHttpServer()).post('/rooms/start').set(h).send({ code });

    // Bot motoruyla bu tohuma GEÇERLİ transkript üret (her hamle tahtayı değiştirir).
    const validMoves = playBotGame(seed, 'easy', 40).moves;
    const expected = replayGame(seed, validMoves, 4);

    // İstemci şişirilmiş 'score' göndermeye çalışsa bile SUNUCU hesaplar.
    const prog = await request(app.getHttpServer()).post('/rooms/progress').set(h)
      .send({ code, moves: validMoves, score: 999999 });
    expect(prog.status).toBe(200);
    const meRow = prog.body.room.players.find((p: any) => p.id === host.user.id);
    expect(meRow.score).toBe(expected.score);
    expect(meRow.score).toBeGreaterThan(0);

    // Bozuk transkript → skor GERİLEMEZ (MAX korunur), yazılmaz.
    const bad = await request(app.getHttpServer()).post('/rooms/progress').set(h)
      .send({ code, moves: 'ZZZZZZ', score: 999999 });
    expect(bad.status).toBe(200);
    const meRow2 = bad.body.room.players.find((p: any) => p.id === host.user.id);
    expect(meRow2.score).toBe(expected.score); // değişmedi
  });
});
