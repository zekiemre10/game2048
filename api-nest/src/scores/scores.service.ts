import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { MonthlyScore } from '../schemas/monthly-score.schema';
import { DailyScore } from '../schemas/daily-score.schema';
import { MonthlyPrize } from '../schemas/monthly-prize.schema';
import { FlaggedSubmission } from '../schemas/flagged-submission.schema';
import { Friendship } from '../schemas/friendship.schema';
import { AuthUser } from '../common/current-user.decorator';
import { apiError } from '../common/api-error';
import { RateLimitService } from '../common/rate-limit.service';
import { nowSec, utcDay, utcMonth } from '../common/time';
import { CHAMPION_PRIZE, MAX_MOVES, SUBMIT_MAX, SUBMIT_WINDOW } from '../common/constants';
import { replayGame } from '../replay/replay';
import { verifyTranscript } from './verify';
import { dailySeed } from './seed';
import { friendPublic } from '../users/progress';

/** Sapma eşiği: |claimed-score| > max(50, floor(score/20)) → işaretle. */
function claimMismatch(claimed: number, score: number): boolean {
  return claimed > 0 && Math.abs(claimed - score) > Math.max(50, Math.floor(score / 20));
}

@Injectable()
export class ScoresService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(MonthlyScore.name) private monthly: Model<MonthlyScore>,
    @InjectModel(DailyScore.name) private daily: Model<DailyScore>,
    @InjectModel(MonthlyPrize.name) private prizes: Model<MonthlyPrize>,
    @InjectModel(FlaggedSubmission.name) private flags: Model<FlaggedSubmission>,
    @InjectModel(Friendship.name) private friendships: Model<Friendship>,
    private rl: RateLimitService,
  ) {}

  private async flag(
    me: AuthUser, endpoint: string, reason: string,
    claimed: number | null, computed: number | null, moves: number, seed: number,
  ): Promise<void> {
    await this.flags.create({
      user_id: me.id, username: me.username, endpoint, reason,
      claimed_score: claimed, computed_score: computed, moves, seed, created: nowSec(),
    });
  }

  /** app.py settle_finished_months — biten ayların şampiyonunu yaz (tembel). */
  async settleFinishedMonths(): Promise<void> {
    const nowMonth = utcMonth();
    const months: string[] = await this.monthly.distinct('month', { month: { $lt: nowMonth } });
    for (const month of months) {
      const exists = await this.prizes.findOne({ month }).lean();
      if (exists) continue;
      const top = await this.monthly
        .findOne({ month, score: { $gt: 0 } })
        .sort({ score: -1, updated: 1 })
        .lean();
      if (!top) continue;
      try {
        await this.prizes.create({
          month, user_id: top.user_id, username: top.username,
          score: top.score, claimed: 0, created: nowSec(),
        });
      } catch (e: any) {
        if (e?.code !== 11000) throw e; // yarış: başka istek yazdı
      }
    }
  }

  private async pendingPrize(userId: number): Promise<any> {
    const row = await this.prizes
      .findOne({ user_id: userId, claimed: 0 })
      .sort({ month: 1 })
      .lean();
    if (!row) return null;
    return { month: row.month, score: row.score, ...CHAMPION_PRIZE };
  }

  /** app.py leaderboard_rows — data JSON'undan skor, Python'da sırala. */
  private async leaderboardRows(userIds: number[] | null, limit = 50) {
    let rows: Array<{ id: number; username: string; data: string }>;
    if (userIds !== null) {
      if (userIds.length === 0) return [];
      rows = await this.users.find({ id: { $in: userIds } }, { id: 1, username: 1, data: 1 }).lean();
    } else {
      rows = await this.users.find({}, { id: 1, username: 1, data: 1 }).lean();
    }
    const people = rows.map((r) => friendPublic(r));
    people.sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.bestTile - a.bestTile ||
        a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
    );
    const top = people.slice(0, limit) as any[];
    top.forEach((p, i) => (p.rank = i + 1));
    return top;
  }

  async leaderboard(me: AuthUser, scopeRaw: string | undefined) {
    const scope = (scopeRaw || 'monthly').toLowerCase();
    await this.settleFinishedMonths();

    if (scope === 'monthly') {
      const month = utcMonth();
      const rows = await this.monthly
        .find({ month })
        .sort({ score: -1, best: -1, updated: 1 })
        .limit(50)
        .lean();
      const top = rows.map((r, i) => ({
        id: r.user_id, username: r.username, bestScore: r.score,
        bestTile: r.best, bestLevel: 0, rank: i + 1,
      }));
      let mine: any = top.find((p) => p.id === me.id) ?? null;
      if (!mine) {
        const own = await this.monthly.findOne({ month, user_id: me.id }).lean();
        if (own) {
          const higher = await this.monthly.countDocuments({ month, score: { $gt: own.score } });
          mine = {
            id: me.id, username: me.username, bestScore: own.score,
            bestTile: own.best, bestLevel: 0, rank: higher + 1,
          };
        }
      }
      return { scope, month, top, me: mine, prize: await this.pendingPrize(me.id) };
    }

    let top: any[];
    let mine: any;
    if (scope === 'friends') {
      const fr = await this.friendships
        .find({ status: 'accepted', $or: [{ requester_id: me.id }, { addressee_id: me.id }] })
        .lean();
      const ids = fr.map((f) => (f.requester_id === me.id ? f.addressee_id : f.requester_id));
      ids.push(me.id);
      top = await this.leaderboardRows(ids);
      mine = top.find((p) => p.id === me.id) ?? null;
    } else {
      top = await this.leaderboardRows(null);
      mine = top.find((p) => p.id === me.id) ?? null;
      if (!mine) {
        const everyone = await this.leaderboardRows(null, 10_000_000);
        mine = everyone.find((p) => p.id === me.id) ?? null;
      }
    }
    return { scope, top, me: mine, prize: await this.pendingPrize(me.id) };
  }

  async monthlySubmit(me: AuthUser, body: any) {
    if (!this.rl.allow('submit', me.id, SUBMIT_MAX, SUBMIT_WINDOW)) {
      throw apiError(429, 'too_many_submissions');
    }
    const claimed = Number(body?.score) || 0;
    const v = verifyTranscript(body);
    const seed = (Number(body?.seed) || 0) >>> 0;
    const movesLen = String(body?.moves ?? '').length;

    if (!v.ok) {
      await this.flag(me, 'monthly', v.info, claimed, null, movesLen, seed);
      throw apiError(400, 'invalid_score');
    }
    if (claimMismatch(claimed, v.score)) {
      await this.flag(me, 'monthly', 'claimed_mismatch', claimed, v.score, movesLen, seed);
    }

    const month = utcMonth();
    const prev = await this.monthly.findOne({ month, user_id: me.id }).lean();
    const improved = prev === null || v.score > prev.score;
    if (improved) {
      await this.monthly.updateOne(
        { month, user_id: me.id },
        { $set: { username: me.username, score: v.score, best: v.best, updated: nowSec() } },
        { upsert: true },
      );
    }
    return { ok: true, improved, month, score: v.score };
  }

  async monthlyClaim(me: AuthUser) {
    await this.settleFinishedMonths();
    const row = await this.prizes
      .findOne({ user_id: me.id, claimed: 0 })
      .sort({ month: 1 })
      .lean();
    if (!row) throw apiError(404, 'no_prize');
    await this.prizes.updateOne({ month: row.month, user_id: me.id }, { $set: { claimed: 1 } });
    return { ok: true, month: row.month, ...CHAMPION_PRIZE };
  }

  async dailyInfo(me: AuthUser) {
    const day = utcDay();
    const rows = await this.daily
      .find({ day })
      .sort({ score: -1, best: -1, updated: 1 })
      .limit(50)
      .lean();
    const top = rows.map((r, i) => ({
      id: r.user_id, username: r.username, score: r.score,
      best: r.best, moves: r.moves, rank: i + 1,
    }));
    let mine: any = top.find((x) => x.id === me.id) ?? null;
    if (!mine) {
      const own = await this.daily.findOne({ day, user_id: me.id }).lean();
      if (own) {
        const higher = await this.daily.countDocuments({ day, score: { $gt: own.score } });
        mine = {
          id: me.id, username: me.username, score: own.score,
          best: own.best, moves: own.moves, rank: higher + 1,
        };
      }
    }
    const players = await this.daily.countDocuments({ day });
    return { day, seed: dailySeed(day), top, me: mine, players };
  }

  async dailySubmit(me: AuthUser, body: any) {
    if (!this.rl.allow('submit', me.id, SUBMIT_MAX, SUBMIT_WINDOW)) {
      throw apiError(429, 'too_many_submissions');
    }
    const claimed = Number(body?.score) || 0;
    const day = utcDay();
    const movesStr = body?.moves;
    if (typeof movesStr !== 'string' || movesStr.length > MAX_MOVES) {
      await this.flag(me, 'daily', 'missing_transcript', claimed, null, 0, 0);
      throw apiError(400, 'invalid_score');
    }
    // GÜNÜN tohumu sunucudan; istemci tohumu yok sayılır. Günlük hep 4×4.
    const seed = dailySeed(day);
    const result = replayGame(seed, movesStr, 4);
    if (!result.valid) {
      await this.flag(me, 'daily', 'invalid_replay', claimed, null, movesStr.length, seed);
      throw apiError(400, 'invalid_score');
    }
    const score = result.score;
    const best = result.maxTile;
    const moves = result.moves;
    if (claimMismatch(claimed, score)) {
      await this.flag(me, 'daily', 'claimed_mismatch', claimed, score, moves, seed);
    }
    const prev = await this.daily.findOne({ day, user_id: me.id }).lean();
    const improved = prev === null || score > prev.score;
    if (improved) {
      await this.daily.updateOne(
        { day, user_id: me.id },
        { $set: { username: me.username, score, best, moves, updated: nowSec() } },
        { upsert: true },
      );
    }
    return { ok: true, improved, day };
  }
}
