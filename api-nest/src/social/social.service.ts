import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Friendship } from '../schemas/friendship.schema';
import { Message } from '../schemas/message.schema';
import { Report } from '../schemas/report.schema';
import { AuthUser } from '../common/current-user.decorator';
import { apiError } from '../common/api-error';
import { RateLimitService } from '../common/rate-limit.service';
import { CountersService } from '../common/counters.service';
import { nowSec } from '../common/time';
import { containsBanned } from '../common/constants';
import { friendPublic } from '../users/progress';
import { userPublic } from '../auth/auth.service';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Friendship.name) private friendships: Model<Friendship>,
    @InjectModel(Message.name) private messages: Model<Message>,
    @InjectModel(Report.name) private reports: Model<Report>,
    private rl: RateLimitService,
    private counters: CountersService,
  ) {}

  private async areFriends(a: number, b: number): Promise<boolean> {
    const row = await this.friendships.exists({
      status: 'accepted',
      $or: [
        { requester_id: a, addressee_id: b },
        { requester_id: b, addressee_id: a },
      ],
    });
    return !!row;
  }

  async search(me: AuthUser, qRaw: string | undefined) {
    if (!this.rl.allow('search', me.id, 30, 60)) throw apiError(429, 'too_many_requests');
    const q = String(qRaw ?? '').trim();
    if (q.length < 2 || q.length > 20) return { users: [] };
    const rx = new RegExp(escapeRegex(q.toLowerCase()));
    const rows = await this.users
      .find({ username_lower: rx, id: { $ne: me.id } })
      .sort({ username: 1 })
      .limit(15)
      .lean();
    return { users: rows.map((r) => userPublic(r)) };
  }

  async friendRequest(me: AuthUser, body: any) {
    if (!this.rl.allow('friend_req', me.id, 20, 60)) throw apiError(429, 'too_many_requests');
    let target: any = null;
    if (body?.id) target = await this.users.findOne({ id: parseInt(body.id, 10) }).lean();
    else if (body?.username)
      target = await this.users.findOne({ username_lower: String(body.username).trim().toLowerCase() }).lean();
    if (!target) throw apiError(404, 'user_not_found');
    if (target.id === me.id) throw apiError(400, 'cannot_add_self');

    const existing = await this.friendships
      .findOne({
        $or: [
          { requester_id: me.id, addressee_id: target.id },
          { requester_id: target.id, addressee_id: me.id },
        ],
      })
      .lean();
    if (existing) {
      if (existing.status === 'accepted') throw apiError(409, 'already_friends');
      if (existing.requester_id === target.id) {
        await this.friendships.updateOne({ id: existing.id }, { $set: { status: 'accepted' } });
        return { ok: true, status: 'accepted' };
      }
      throw apiError(409, 'already_requested');
    }
    const id = await this.counters.next('friendships');
    await this.friendships.create({
      id, requester_id: me.id, addressee_id: target.id, status: 'pending', created: nowSec(),
    });
    return { ok: true, status: 'pending' };
  }

  async friendRespond(me: AuthUser, body: any) {
    const fid = body?.id ? parseInt(body.id, 10) : 0;
    const accept = !!body?.accept;
    const row = await this.friendships.findOne({ id: fid, addressee_id: me.id, status: 'pending' }).lean();
    if (!row) throw apiError(404, 'request_not_found');
    if (accept) await this.friendships.updateOne({ id: row.id }, { $set: { status: 'accepted' } });
    else await this.friendships.deleteOne({ id: row.id });
    return { ok: true };
  }

  async friendRemove(me: AuthUser, body: any) {
    const other = body?.id;
    if (!other) throw apiError(400, 'missing_id');
    const o = parseInt(other, 10);
    await this.friendships.deleteMany({
      $or: [
        { requester_id: me.id, addressee_id: o },
        { requester_id: o, addressee_id: me.id },
      ],
    });
    return { ok: true };
  }

  async friendsList(me: AuthUser) {
    const mid = me.id;
    const accepted = await this.friendships
      .find({ status: 'accepted', $or: [{ requester_id: mid }, { addressee_id: mid }] })
      .lean();
    const friendIds = accepted.map((f) => (f.requester_id === mid ? f.addressee_id : f.requester_id));
    const friendRows = await this.users.find({ id: { $in: friendIds } }, { id: 1, username: 1, data: 1 }).lean();
    friendRows.sort((a, b) => a.username.localeCompare(b.username));

    const incomingF = await this.friendships
      .find({ status: 'pending', addressee_id: mid })
      .sort({ created: -1 })
      .lean();
    const outgoingF = await this.friendships
      .find({ status: 'pending', requester_id: mid })
      .sort({ created: -1 })
      .lean();

    const usersById = new Map<number, any>();
    const need = [
      ...incomingF.map((f) => f.requester_id),
      ...outgoingF.map((f) => f.addressee_id),
    ];
    if (need.length) {
      const us = await this.users.find({ id: { $in: need } }, { id: 1, username: 1, data: 1 }).lean();
      for (const u of us) usersById.set(u.id, u);
    }
    const withReq = (rows: any[], otherId: (f: any) => number) =>
      rows
        .map((f) => {
          const u = usersById.get(otherId(f));
          if (!u) return null;
          return { ...friendPublic(u), reqId: f.id };
        })
        .filter(Boolean);

    return {
      friends: friendRows.map((r) => friendPublic(r)),
      incoming: withReq(incomingF, (f) => f.requester_id),
      outgoing: withReq(outgoingF, (f) => f.addressee_id),
    };
  }

  async messageSend(me: AuthUser, body: any) {
    if (!this.rl.allow('msg', me.id, 30, 60)) throw apiError(429, 'too_many_requests');
    const to = body?.to;
    let text = String(body?.body ?? '').trim();
    if (!to) throw apiError(400, 'missing_to');
    if (!text) throw apiError(400, 'empty_message');
    if (text.length > 500) text = text.slice(0, 500);
    if (containsBanned(text)) throw apiError(400, 'banned_word');
    const toId = parseInt(to, 10);
    if (!(await this.areFriends(me.id, toId))) throw apiError(403, 'not_friends');
    const now = nowSec();
    const id = await this.counters.next('messages');
    await this.messages.create({ id, from_id: me.id, to_id: toId, body: text, created: now });
    return { ok: true, message: { id, from_id: me.id, to_id: toId, body: text, created: now } };
  }

  async messagesList(me: AuthUser, withRaw: string | undefined, afterRaw: string | undefined) {
    if (!withRaw) throw apiError(400, 'missing_with');
    const other = parseInt(withRaw, 10);
    const after = /^\d+$/.test(String(afterRaw)) ? parseInt(String(afterRaw), 10) : 0;
    const rows = await this.messages
      .find({
        id: { $gt: after },
        $or: [
          { from_id: me.id, to_id: other },
          { from_id: other, to_id: me.id },
        ],
      })
      .sort({ id: 1 })
      .limit(200)
      .lean();
    return {
      messages: rows.map((r) => ({
        id: r.id, from_id: r.from_id, to_id: r.to_id, body: r.body, created: r.created,
      })),
    };
  }

  async messagesOverview(me: AuthUser) {
    const mid = me.id;
    const grouped = await this.messages.aggregate([
      { $match: { $or: [{ from_id: mid }, { to_id: mid }] } },
      { $project: { from_id: 1, to_id: 1, id: 1, other: { $cond: [{ $eq: ['$from_id', mid] }, '$to_id', '$from_id'] } } },
      { $group: { _id: '$other', lastId: { $max: '$id' } } },
    ]);
    const lastIds = grouped.map((g) => g.lastId);
    const lasts = await this.messages.find({ id: { $in: lastIds } }, { id: 1, from_id: 1, body: 1, created: 1 }).lean();
    const byId = new Map<number, any>();
    for (const m of lasts) byId.set(m.id, m);
    const conversations = grouped.map((g) => {
      const last = byId.get(g.lastId);
      return {
        other: g._id,
        lastId: g.lastId,
        lastFrom: last?.from_id,
        lastBody: last?.body,
        lastCreated: last?.created,
      };
    });
    return { conversations };
  }

  async report(me: AuthUser, body: any) {
    if (!this.rl.allow('report', me.id, 10, 3600)) throw apiError(429, 'too_many_requests');
    let target: any = null;
    if (body?.targetId) target = await this.users.findOne({ id: parseInt(body.targetId, 10) }, { id: 1 }).lean();
    else if (body?.targetUsername)
      target = await this.users.findOne({ username_lower: String(body.targetUsername).trim().toLowerCase() }, { id: 1 }).lean();
    if (!target) throw apiError(404, 'user_not_found');
    if (target.id === me.id) throw apiError(400, 'cannot_report_self');
    let reason = String(body?.reason ?? 'other').trim().toLowerCase();
    if (!['spam', 'harassment', 'cheating', 'other'].includes(reason)) reason = 'other';
    const detail = String(body?.detail ?? '').slice(0, 500);
    const context = String(body?.context ?? '').slice(0, 32);
    const id = await this.counters.next('reports');
    await this.reports.create({
      id, reporter_id: me.id, target_id: target.id, reason, detail, context, created: nowSec(),
    });
    return { ok: true };
  }
}
