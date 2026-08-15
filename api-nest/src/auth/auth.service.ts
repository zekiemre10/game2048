import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { Session } from '../schemas/session.schema';
import { CountersService } from '../common/counters.service';
import { RateLimitService } from '../common/rate-limit.service';
import { apiError } from '../common/api-error';
import { nowSec } from '../common/time';
import {
  USERNAME_RE, EMAIL_RE, MAX_DATA,
  LOGIN_MAX_TRIES, LOGIN_WINDOW, containsBanned,
} from '../common/constants';
import { hashPw, verifyPw, newSalt, newToken } from './crypto';
import { mergeProgress } from '../users/progress';

/** {id, username, created} — app.py user_public (email SIZMAZ). */
export function userPublic(u: { id: number; username: string; created: number }) {
  return { id: u.id, username: u.username, created: u.created };
}

/** Python len(str) = kod noktası sayısı (byte değil). Blob sınırı için birebir. */
function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Session.name) private sessions: Model<Session>,
    private counters: CountersService,
    private rl: RateLimitService,
  ) {}

  /** sessions'a yeni Bearer token yazar (app.py make_token). */
  async issueToken(userId: number): Promise<string> {
    const token = newToken();
    await this.sessions.create({ token, user_id: userId, created: nowSec() });
    return token;
  }

  async register(body: any, ip: string) {
    if (!this.rl.allow('register', ip, 8, 600)) throw apiError(429, 'too_many_attempts');

    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    const email = String(body?.email ?? '').trim();

    if (!USERNAME_RE.test(username)) throw apiError(400, 'invalid_username');
    if (containsBanned(username)) throw apiError(400, 'banned_username');
    if (!EMAIL_RE.test(email)) throw apiError(400, 'invalid_email');
    if (password.length < 6) throw apiError(400, 'weak_password');

    const lower = username.toLowerCase();
    const exists = await this.users.findOne({ username_lower: lower }).lean();
    if (exists) throw apiError(409, 'username_taken');

    const salt = newSalt();
    const raw = body?.data;
    const data = JSON.stringify(mergeProgress({}, raw && typeof raw === 'object' ? raw : {}));
    if (codePoints(data) > MAX_DATA) throw apiError(400, 'invalid_data');

    const id = await this.counters.next('users');
    const created = nowSec();
    try {
      await this.users.create({
        id, username, username_lower: lower, email,
        pwhash: hashPw(password, salt), salt, data, created,
      });
    } catch (e: any) {
      if (e?.code === 11000) throw apiError(409, 'username_taken'); // yarış
      throw e;
    }
    const token = await this.issueToken(id);
    return { token, user: userPublic({ id, username, created }) };
  }

  async login(body: any) {
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    const lower = username.toLowerCase();
    if (!this.rl.allow('login', lower, LOGIN_MAX_TRIES, LOGIN_WINDOW)) {
      throw apiError(429, 'too_many_attempts');
    }
    const row = await this.users.findOne({ username_lower: lower });
    if (!row) throw apiError(401, 'bad_credentials');
    const v = verifyPw(row.pwhash, row.salt, password);
    if (!v.ok) throw apiError(401, 'bad_credentials');
    if (v.upgraded) {
      row.pwhash = v.upgraded; // eski turlu hash'i sessizce 600k'ya yükselt
      await row.save();
    }
    this.rl.clear('login', lower);
    const token = await this.issueToken(row.id);
    return { token, user: userPublic(row) };
  }

  async logout(token: string | null) {
    if (!token) throw apiError(401, 'unauthorized');
    await this.sessions.deleteOne({ token });
    return { ok: true };
  }
}
