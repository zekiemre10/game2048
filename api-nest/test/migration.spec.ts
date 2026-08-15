import { DatabaseSync } from 'node:sqlite';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { runMigration } from '../scripts/migrate-sqlite-to-mongo';

// ============================================================
//  Göç testi (KABUL KRİTERİ: kullanıcı/skor/rozet kayıpsız, sayılar eşit,
//  tekrar çalıştırılabilir). Geçici sqlite kurulur, bellek-içi Mongo'ya göç
//  edilir; ikinci koşu çoğaltma yapmamalı; sayaç en büyük id'nin üstüne çıkmalı.
// ============================================================

let mongod: MongoMemoryServer;
const DB_FILE = join(tmpdir(), `game2048-mig-${process.pid}.db`);
const DB_NAME = 'game2048_mig_test';
let uri: string;

function seedSqlite() {
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, username_lower TEXT,
      pwhash TEXT, salt TEXT, data TEXT, created INTEGER, email TEXT);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, created INTEGER);
    CREATE TABLE friendships (id INTEGER PRIMARY KEY, requester_id INTEGER, addressee_id INTEGER, status TEXT, created INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, from_id INTEGER, to_id INTEGER, body TEXT, created INTEGER);
    CREATE TABLE reports (id INTEGER PRIMARY KEY, reporter_id INTEGER, target_id INTEGER, reason TEXT, detail TEXT, context TEXT, created INTEGER);
    CREATE TABLE monthly_scores (month TEXT, user_id INTEGER, username TEXT, score INTEGER, best INTEGER, updated INTEGER);
    CREATE TABLE monthly_prizes (month TEXT, user_id INTEGER, username TEXT, score INTEGER, claimed INTEGER, created INTEGER);
    CREATE TABLE daily_scores (day TEXT, user_id INTEGER, username TEXT, score INTEGER, best INTEGER, moves INTEGER, updated INTEGER);
    CREATE TABLE flagged_submissions (id INTEGER PRIMARY KEY, user_id INTEGER, username TEXT, endpoint TEXT, reason TEXT, claimed_score INTEGER, computed_score INTEGER, moves INTEGER, seed INTEGER, created INTEGER);
    CREATE TABLE rooms (code TEXT PRIMARY KEY, host_id INTEGER, status TEXT, seed INTEGER, duration INTEGER, started_at INTEGER, created INTEGER);
    CREATE TABLE room_players (code TEXT, user_id INTEGER, username TEXT, level TEXT, score INTEGER, best INTEGER, done INTEGER, joined INTEGER);
  `);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(1, 'Ada', 'ada', 'h1', 's1', '{"bestScore":900,"achievements":["x"]}', 1000, 'ada@e.com');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(5, 'Bee', 'bee', 'h2', 's2', '{"bestScore":300}', 1001, null);
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('tok-abc', 1, 1000);
  db.prepare('INSERT INTO friendships VALUES (?,?,?,?,?)').run(3, 1, 5, 'accepted', 1002);
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(7, 1, 5, 'selam', 1003);
  db.prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?)').run(2, 5, 1, 'spam', 'x', 'ctx', 1004);
  db.prepare('INSERT INTO monthly_scores VALUES (?,?,?,?,?,?)').run('2026-07', 1, 'Ada', 5000, 512, 1005);
  db.prepare('INSERT INTO monthly_prizes VALUES (?,?,?,?,?,?)').run('2026-07', 1, 'Ada', 5000, 0, 1006);
  db.prepare('INSERT INTO daily_scores VALUES (?,?,?,?,?,?,?)').run('2026-08-14', 5, 'Bee', 1200, 128, 60, 1007);
  db.prepare('INSERT INTO flagged_submissions VALUES (?,?,?,?,?,?,?,?,?,?)').run(9, 5, 'Bee', 'monthly', 'invalid_replay', null, null, 10, 123, 1008);
  db.close();
}

beforeAll(async () => {
  seedSqlite();
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
  await mongod?.stop();
  try {
    rmSync(DB_FILE, { force: true });
  } catch {
    /* ignore */
  }
});

describe('sqlite → Mongo göçü', () => {
  it('kayıpsız: her tablo sqlite == mongo', async () => {
    const { report, mismatch } = await runMigration({ dbPath: DB_FILE, mongoUri: uri, dbName: DB_NAME });
    expect(mismatch).toBe(0);
    expect(report.users).toEqual({ sqlite: 2, mongo: 2 });
    expect(report.friendships).toEqual({ sqlite: 1, mongo: 1 });
    expect(report.messages).toEqual({ sqlite: 1, mongo: 1 });
    expect(report.monthly_scores).toEqual({ sqlite: 1, mongo: 1 });
    expect(report.monthly_prizes).toEqual({ sqlite: 1, mongo: 1 });
    expect(report.daily_scores).toEqual({ sqlite: 1, mongo: 1 });
    expect(report.flagged_submissions).toEqual({ sqlite: 1, mongo: 1 });
  });

  it('idempotent: ikinci koşu çoğaltmaz', async () => {
    const { report, mismatch } = await runMigration({ dbPath: DB_FILE, mongoUri: uri, dbName: DB_NAME });
    expect(mismatch).toBe(0);
    expect(report.users.mongo).toBe(2); // hâlâ 2, çoğalmadı
    expect(report.flagged_submissions.mongo).toBe(1);
  });

  it('sayaç en büyük id üstüne çekildi (yeni kayıt sürer)', async () => {
    const conn = await mongoose.createConnection(uri, { dbName: DB_NAME }).asPromise();
    const counters = conn.collection('counters');
    const users = await counters.findOne({ _id: 'users' as any });
    const msgs = await counters.findOne({ _id: 'messages' as any });
    expect(users?.seq).toBe(5); // max users.id
    expect(msgs?.seq).toBe(7); // max messages.id
    await conn.close();
  });

  it('veri doğru taşındı (örnek alanlar)', async () => {
    const conn = await mongoose.createConnection(uri, { dbName: DB_NAME }).asPromise();
    const u = await conn.collection('users').findOne({ id: 1 });
    expect(u?.username).toBe('Ada');
    expect(u?.email).toBe('ada@e.com');
    const prize = await conn.collection('monthly_prizes').findOne({ month: '2026-07' });
    expect(prize?.score).toBe(5000);
    expect(prize?.claimed).toBe(0);
    await conn.close();
  });
});
