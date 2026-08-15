import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../schemas/user.schema';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { apiError } from '../common/api-error';
import { MAX_DATA } from '../common/constants';
import { mergeProgress } from './progress';
import { userPublic } from '../auth/auth.service';

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** /me + /sync — app.py _me/_sync birebir. */
@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@InjectModel(User.name) private users: Model<User>) {}

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    let data: unknown = {};
    try {
      data = JSON.parse(u.data || '{}');
    } catch {
      data = {};
    }
    return { user: userPublic(u), data };
  }

  @Post('sync')
  async sync(@CurrentUser() u: AuthUser, @Body() body: any) {
    const incoming = body?.data;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      throw apiError(400, 'invalid_data');
    }
    let stored: unknown = {};
    try {
      stored = JSON.parse(u.data || '{}');
    } catch {
      stored = {};
    }
    const merged = mergeProgress(stored, incoming);
    const blob = JSON.stringify(merged);
    if (codePoints(blob) > MAX_DATA) throw apiError(400, 'invalid_data');
    await this.users.updateOne({ id: u.id }, { $set: { data: blob } });
    return { ok: true, user: userPublic(u), data: merged };
  }
}
