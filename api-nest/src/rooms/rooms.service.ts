import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomInt } from 'node:crypto';
import { Room } from '../schemas/room.schema';
import { RoomPlayer } from '../schemas/room-player.schema';
import { FlaggedSubmission } from '../schemas/flagged-submission.schema';
import { AuthUser } from '../common/current-user.decorator';
import { apiError } from '../common/api-error';
import { RateLimitService } from '../common/rate-limit.service';
import { nowSec } from '../common/time';
import { MAX_MOVES, ROOM_ALPHABET, MAX_BOTS_PER_ROOM, ROOM_STALE_SECONDS } from '../common/constants';
import { verifyTranscript } from '../scores/verify';
import { BotTimelineService } from './bot-timeline.service';
import { isCharacter } from './bot-ai';

const CHAR_NAMES: Record<string, string> = {
  corner: '📐 Köşeci', space: '🌿 Alan Açan', hasty: '⚡ Acelesi Var', balanced: '⚖️ Dengeli',
};
const LEVEL_NAMES: Record<string, string> = {
  easy: '🤖 Bot (Kolay)', medium: '🤖 Bot (Orta)', hard: '🤖 Bot (Zor)', expert: '🤖 Bot (Uzman)',
};

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private rooms: Model<Room>,
    @InjectModel(RoomPlayer.name) private players: Model<RoomPlayer>,
    @InjectModel(FlaggedSubmission.name) private flags: Model<FlaggedSubmission>,
    private rl: RateLimitService,
    private bots: BotTimelineService,
  ) {}

  private async reapStaleRooms(): Promise<void> {
    const cutoff = nowSec() - ROOM_STALE_SECONDS;
    const stale = await this.rooms.find({ created: { $lt: cutoff } }, { code: 1 }).lean();
    const codes = stale.map((r) => r.code);
    if (codes.length) {
      await this.players.deleteMany({ code: { $in: codes } });
      await this.rooms.deleteMany({ code: { $in: codes } });
    }
  }

  private async genRoomCode(): Promise<string> {
    const pick = (len: number) =>
      Array.from({ length: len }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
    for (let i = 0; i < 50; i++) {
      const code = pick(4);
      if (!(await this.rooms.exists({ code }))) return code;
    }
    return pick(6);
  }

  /** app.py room_state birebir (bot skorları çizelgeden, sıralamadan ÖNCE). */
  async roomState(code: string): Promise<any> {
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) return null;
    const now = nowSec();
    let status = room.status;
    if (status === 'racing' && room.started_at && now >= room.started_at + room.duration) {
      await this.rooms.updateOne({ code }, { $set: { status: 'finished' } });
      status = 'finished';
    }
    const rows = await this.players.find({ code }).lean();
    const started = room.started_at;
    const racing = (status === 'racing' || status === 'finished') && !!started;
    const elapsedMs = racing
      ? Math.max(0, Math.min(now, (started as number) + room.duration) - (started as number)) * 1000
      : 0;

    const players = rows.map((p) => {
      const isBot = p.user_id < 0;
      let score = p.score;
      let best = p.best;
      let done = !!p.done;
      if (isBot) {
        if (racing) {
          this.bots.ensure(code, p.user_id, room.seed, p.level, room.duration);
          const s = this.bots.scoreAt(code, p.user_id, elapsedMs);
          score = s.score;
          best = s.best;
          done = s.done;
        } else {
          score = 0;
          best = 0;
          done = false;
        }
      }
      const key = p.level;
      const isChar = isBot && isCharacter(key);
      return {
        id: p.user_id,
        username: p.username,
        score,
        best,
        done,
        isBot,
        character: isChar ? key : null,
        level: isChar ? null : isBot ? key : null,
      };
    });

    players.sort(
      (a, b) => b.score - a.score || b.best - a.best || a.username.localeCompare(b.username),
    );

    return {
      code: room.code,
      hostId: room.host_id,
      status,
      seed: room.seed,
      duration: room.duration,
      startedAt: started ?? null,
      now,
      players,
    };
  }

  async create(me: AuthUser, body: any) {
    if (!this.rl.allow('room_create', me.id, 10, 60)) throw apiError(429, 'too_many_requests');
    let duration = parseInt(body?.duration, 10) || 180;
    duration = Math.max(30, Math.min(600, duration));
    await this.reapStaleRooms();
    const code = await this.genRoomCode();
    const seed = randomInt(2_000_000_000) + 1;
    const now = nowSec();
    await this.rooms.create({ code, host_id: me.id, status: 'lobby', seed, duration, created: now });
    await this.players.create({ code, user_id: me.id, username: me.username, joined: now });
    return { room: await this.roomState(code) };
  }

  async join(me: AuthUser, body: any) {
    const code = String(body?.code ?? '').trim().toUpperCase();
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    if (room.status !== 'lobby') throw apiError(409, 'already_started');
    // INSERT OR IGNORE (code,user_id benzersiz)
    await this.players.updateOne(
      { code, user_id: me.id },
      { $setOnInsert: { username: me.username, joined: nowSec() } },
      { upsert: true },
    );
    return { room: await this.roomState(code) };
  }

  async leave(me: AuthUser, body: any) {
    const code = String(body?.code ?? '').trim().toUpperCase();
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) return { ok: true };
    if (room.host_id === me.id) {
      await this.players.deleteOne({ code, user_id: me.id });
      const heir = await this.players
        .findOne({ code, user_id: { $gt: 0 } })
        .sort({ joined: 1 })
        .lean();
      if (heir) {
        await this.rooms.updateOne({ code }, { $set: { host_id: heir.user_id } });
      } else {
        await this.players.deleteMany({ code });
        await this.rooms.deleteOne({ code });
        this.bots.drop(code);
      }
    } else {
      await this.players.deleteOne({ code, user_id: me.id });
    }
    return { ok: true };
  }

  async start(me: AuthUser, body: any) {
    const code = String(body?.code ?? '').trim().toUpperCase();
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    if (room.host_id !== me.id) throw apiError(403, 'not_host');
    if (room.status !== 'lobby') throw apiError(409, 'already_started');
    await this.rooms.updateOne({ code }, { $set: { status: 'racing', started_at: nowSec() } });
    await this.players.updateMany({ code }, { $set: { score: 0, best: 0, done: 0 } });
    this.bots.drop(code); // yeniden başlatmaya karşı temiz başla
    const botRows = await this.players.find({ code, user_id: { $lt: 0 } }, { user_id: 1, level: 1 }).lean();
    for (const b of botRows) {
      this.bots.ensure(code, b.user_id, room.seed, b.level, room.duration);
    }
    return { room: await this.roomState(code) };
  }

  /** OYUN-311: oda skoru İSTEMCİDEN alınmaz — transkript sunucuda replay edilir. */
  async progress(me: AuthUser, body: any) {
    if (!this.rl.allow('room', me.id, 180, 60)) throw apiError(429, 'too_many_requests');
    const code = String(body?.code ?? '').trim().toUpperCase();
    const done = body?.done ? 1 : 0;
    const moves = body?.moves;
    if (typeof moves !== 'string' || moves.length > MAX_MOVES) throw apiError(400, 'invalid_transcript');
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    const member = await this.players.exists({ code, user_id: me.id });
    if (!member) throw apiError(403, 'not_in_room');
    if (room.status !== 'racing') {
      return { room: await this.roomState(code) };
    }
    const v = verifyTranscript({ seed: room.seed, moves, size: 4 });
    if (!v.ok) {
      await this.flags.create({
        user_id: me.id, username: me.username, endpoint: 'room', reason: v.info,
        claimed_score: null, computed_score: null, moves: moves.length, seed: room.seed, created: nowSec(),
      });
      return { room: await this.roomState(code) };
    }
    // MAX(): skor monoton; geç/sıra dışı bildirim geriletemez.
    await this.players.updateOne({ code, user_id: me.id }, [
      {
        $set: {
          score: { $max: ['$score', v.score] },
          best: { $max: ['$best', v.best] },
          done: { $max: ['$done', done] },
        },
      },
    ]);
    return { room: await this.roomState(code) };
  }

  async addBot(me: AuthUser, body: any) {
    const code = String(body?.code ?? '').trim().toUpperCase();
    const character = String(body?.character ?? '').toLowerCase().trim();
    let key: string;
    let display: string;
    if (character) {
      if (!(character in CHAR_NAMES)) throw apiError(400, 'invalid_character');
      key = character;
      display = CHAR_NAMES[character];
    } else {
      const diff = String(body?.difficulty ?? 'medium').toLowerCase();
      if (!(diff in LEVEL_NAMES)) throw apiError(400, 'invalid_level');
      key = diff;
      display = LEVEL_NAMES[diff];
    }
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    if (room.host_id !== me.id) throw apiError(403, 'not_host');
    if (room.status !== 'lobby') throw apiError(409, 'already_started');
    const botCount = await this.players.countDocuments({ code, user_id: { $lt: 0 } });
    if (botCount >= MAX_BOTS_PER_ROOM) throw apiError(409, 'too_many_bots');
    const minRow = await this.players.findOne({ code }).sort({ user_id: 1 }).lean();
    const botId = Math.min(0, minRow?.user_id ?? 0) - 1;
    try {
      await this.players.create({ code, user_id: botId, username: display, level: key, joined: nowSec() });
    } catch (e: any) {
      if (e?.code === 11000) throw apiError(409, 'try_again');
      throw e;
    }
    return { room: await this.roomState(code), botId };
  }

  async removeBot(me: AuthUser, body: any) {
    const code = String(body?.code ?? '').trim().toUpperCase();
    const botId = body?.botId != null ? parseInt(body.botId, 10) : 0;
    const room = await this.rooms.findOne({ code }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    if (room.host_id !== me.id) throw apiError(403, 'not_host');
    // Yalnız bot (negatif id) silinir — app.py user_id<0 koşulu.
    if (botId < 0) await this.players.deleteOne({ code, user_id: botId });
    return { room: await this.roomState(code) };
  }

  async state(me: AuthUser, code: string) {
    const c = String(code ?? '').trim().toUpperCase();
    const room = await this.rooms.findOne({ code: c }).lean();
    if (!room) throw apiError(404, 'room_not_found');
    const member = await this.players.exists({ code: c, user_id: me.id });
    if (!member) throw apiError(403, 'not_in_room');
    return { room: await this.roomState(c) };
  }
}
