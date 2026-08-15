/* eslint-disable no-console */
// ============================================================
//  game2048 — sqlite (app.db) → MongoDB göç betiği.
//
//  KAYIPSIZ + IDEMPOTENT + tekrar çalıştırılabilir. Her tablo doğal anahtarına
//  göre upsert edilir; ikinci çalıştırma çoğaltma yapmaz. Sayaçlar (AUTOINCREMENT
//  eşdeğeri) en büyük id'nin üstüne çekilir → göç sonrası yeni kayıtlar sürer.
//
//  Kullanım:
//    GAME2048_DB=/home/emre/game2048-api/app.db \
//    GAME2048_MONGO_URI=mongodb://127.0.0.1:27017 GAME2048_DB_NAME=game2048 \
//    node scripts/migrate-sqlite-to-mongo.ts [--dry-run]
//
//  --dry-run: hiçbir şey YAZMAZ; yalnız tablo sayımlarını raporlar (öncesi/sonrası
//  eşitliğini bu sayılarla doğrularsın).
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import mongoose from 'mongoose';

import { UserSchema } from '../src/schemas/user.schema';
import { SessionSchema } from '../src/schemas/session.schema';
import { FriendshipSchema } from '../src/schemas/friendship.schema';
import { MessageSchema } from '../src/schemas/message.schema';
import { ReportSchema } from '../src/schemas/report.schema';
import { RoomSchema } from '../src/schemas/room.schema';
import { RoomPlayerSchema } from '../src/schemas/room-player.schema';
import { MonthlyScoreSchema } from '../src/schemas/monthly-score.schema';
import { MonthlyPrizeSchema } from '../src/schemas/monthly-prize.schema';
import { DailyScoreSchema } from '../src/schemas/daily-score.schema';
import { FlaggedSubmissionSchema } from '../src/schemas/flagged-submission.schema';
import { CounterSchema } from '../src/schemas/counter.schema';

export interface MigrateOpts {
  dbPath?: string;
  mongoUri?: string;
  dbName?: string;
  dryRun?: boolean;
}

/** sqlite tablosu var mı (eski/kısmi DB'lerde bazı tablolar olmayabilir). */
function tableExists(db: DatabaseSync, name: string): boolean {
  const r = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!r;
}

function readAll(db: DatabaseSync, table: string): any[] {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all() as any[];
}

export async function runMigration(
  opts: MigrateOpts = {},
): Promise<{ report: Record<string, { sqlite: number; mongo: number }>; mismatch: number; dryRun: boolean }> {
  const DRY = opts.dryRun ?? process.argv.includes('--dry-run');
  const DB_PATH =
    opts.dbPath || process.env.GAME2048_DB || path.join(__dirname, '..', '..', 'server', 'app.db');
  const MONGO_URI = opts.mongoUri || process.env.GAME2048_MONGO_URI || 'mongodb://127.0.0.1:27017';
  const DB_NAME = opts.dbName || process.env.GAME2048_DB_NAME || 'game2048';

  console.log(`[migrate] sqlite=${DB_PATH}`);
  console.log(`[migrate] mongo=${MONGO_URI} db=${DB_NAME}  ${DRY ? '(DRY-RUN)' : '(WRITE)'}`);

  const sqlite = new DatabaseSync(DB_PATH, { readOnly: true });

  const conn = await mongoose.createConnection(MONGO_URI, { dbName: DB_NAME }).asPromise();
  // flagged: göç izini (_srcId) için strict:false klon — uygulama şeması kirlenmez.
  const flaggedLoose = FlaggedSubmissionSchema.clone();
  flaggedLoose.set('strict', false);
  const M = {
    users: conn.model('User', UserSchema),
    sessions: conn.model('Session', SessionSchema),
    friendships: conn.model('Friendship', FriendshipSchema),
    messages: conn.model('Message', MessageSchema),
    reports: conn.model('Report', ReportSchema),
    rooms: conn.model('Room', RoomSchema),
    room_players: conn.model('RoomPlayer', RoomPlayerSchema),
    monthly_scores: conn.model('MonthlyScore', MonthlyScoreSchema),
    monthly_prizes: conn.model('MonthlyPrize', MonthlyPrizeSchema),
    daily_scores: conn.model('DailyScore', DailyScoreSchema),
    flagged_submissions: conn.model('FlaggedSubmission', flaggedLoose),
    counters: conn.model('Counter', CounterSchema),
  };

  const report: Record<string, { sqlite: number; mongo: number }> = {};

  // (tablo, model, satır→doküman, doğal-anahtar filtresi)
  const specs: Array<{
    table: string;
    model: mongoose.Model<any>;
    doc: (r: any) => any;
    key: (r: any) => any;
  }> = [
    { table: 'users', model: M.users,
      doc: (r) => ({ id: r.id, username: r.username, username_lower: r.username_lower,
        pwhash: r.pwhash, salt: r.salt, data: r.data ?? '{}', created: r.created, email: r.email ?? null }),
      key: (r) => ({ id: r.id }) },
    { table: 'sessions', model: M.sessions,
      doc: (r) => ({ token: r.token, user_id: r.user_id, created: r.created }),
      key: (r) => ({ token: r.token }) },
    { table: 'friendships', model: M.friendships,
      doc: (r) => ({ id: r.id, requester_id: r.requester_id, addressee_id: r.addressee_id,
        status: r.status, created: r.created }),
      key: (r) => ({ id: r.id }) },
    { table: 'messages', model: M.messages,
      doc: (r) => ({ id: r.id, from_id: r.from_id, to_id: r.to_id, body: r.body, created: r.created }),
      key: (r) => ({ id: r.id }) },
    { table: 'reports', model: M.reports,
      doc: (r) => ({ id: r.id, reporter_id: r.reporter_id, target_id: r.target_id,
        reason: r.reason, detail: r.detail ?? null, context: r.context ?? null, created: r.created }),
      key: (r) => ({ id: r.id }) },
    { table: 'rooms', model: M.rooms,
      doc: (r) => ({ code: r.code, host_id: r.host_id, status: r.status, seed: r.seed,
        duration: r.duration, started_at: r.started_at ?? null, created: r.created }),
      key: (r) => ({ code: r.code }) },
    { table: 'room_players', model: M.room_players,
      doc: (r) => ({ code: r.code, user_id: r.user_id, username: r.username, level: r.level ?? null,
        score: r.score, best: r.best, done: r.done, joined: r.joined }),
      key: (r) => ({ code: r.code, user_id: r.user_id }) },
    { table: 'monthly_scores', model: M.monthly_scores,
      doc: (r) => ({ month: r.month, user_id: r.user_id, username: r.username,
        score: r.score, best: r.best, updated: r.updated }),
      key: (r) => ({ month: r.month, user_id: r.user_id }) },
    { table: 'monthly_prizes', model: M.monthly_prizes,
      doc: (r) => ({ month: r.month, user_id: r.user_id, username: r.username,
        score: r.score, claimed: r.claimed, created: r.created }),
      key: (r) => ({ month: r.month }) },
    { table: 'daily_scores', model: M.daily_scores,
      doc: (r) => ({ day: r.day, user_id: r.user_id, username: r.username,
        score: r.score, best: r.best, moves: r.moves, updated: r.updated }),
      key: (r) => ({ day: r.day, user_id: r.user_id }) },
    { table: 'flagged_submissions', model: M.flagged_submissions,
      // Doğal anahtarı yok → eski rowid'yi anahtar yaparak idempotent kıl.
      doc: (r) => ({ user_id: r.user_id, username: r.username, endpoint: r.endpoint, reason: r.reason,
        claimed_score: r.claimed_score ?? null, computed_score: r.computed_score ?? null,
        moves: r.moves ?? null, seed: r.seed ?? null, created: r.created, _srcId: r.id }),
      key: (r) => ({ _srcId: r.id }) },
  ];

  for (const s of specs) {
    const rows = readAll(sqlite, s.table);
    report[s.table] = { sqlite: rows.length, mongo: 0 };
    if (DRY || rows.length === 0) {
      report[s.table].mongo = await s.model.estimatedDocumentCount().catch(() => 0);
      continue;
    }
    // flagged için _srcId alanını şemaya eklemek yerine strict:false ile yaz.
    const ops = rows.map((r) => ({
      updateOne: { filter: s.key(r), update: { $set: s.doc(r) }, upsert: true },
    }));
    // 1000'lik gruplar (büyük tablolarda bellek/istek dengesi).
    for (let i = 0; i < ops.length; i += 1000) {
      await s.model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
    report[s.table].mongo = await s.model.countDocuments();
  }

  // Sayaçları en büyük id'nin üstüne çek (yeni kayıtlar çakışmasın).
  if (!DRY) {
    const bump = async (name: string, table: string, col = 'id') => {
      const rows = readAll(sqlite, table);
      const maxId = rows.reduce((m, r) => Math.max(m, Number(r[col]) || 0), 0);
      if (maxId > 0) {
        await M.counters.findByIdAndUpdate(name, { $max: { seq: maxId } }, { upsert: true });
      }
    };
    await bump('users', 'users');
    await bump('friendships', 'friendships');
    await bump('messages', 'messages');
    await bump('reports', 'reports');
  }

  console.log('\n[migrate] tablo sayımları (sqlite → mongo):');
  let mismatch = 0;
  for (const [t, c] of Object.entries(report)) {
    const flag = !DRY && c.sqlite !== c.mongo ? '  ⚠️ FARK' : '';
    if (flag) mismatch++;
    console.log(`  ${t.padEnd(20)} sqlite=${String(c.sqlite).padStart(7)}  mongo=${String(c.mongo).padStart(7)}${flag}`);
  }

  sqlite.close();
  await conn.close();

  console.log(`\n[migrate] ${DRY ? 'DRY-RUN bitti (yazılmadı).' : 'Göç tamam.'}`);
  return { report, mismatch, dryRun: DRY };
}

// CLI: doğrudan çalıştırıldığında (import'ta değil).
if (require.main === module) {
  runMigration()
    .then(({ mismatch, dryRun }) => {
      if (!dryRun && mismatch > 0) {
        console.error(`\n[migrate] ${mismatch} tabloda sayı uyuşmazlığı — inceleyin.`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
