import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { User } from '../schemas/user.schema';
import { Session } from '../schemas/session.schema';
import { apiError } from './api-error';
import { TOKEN_TTL } from './constants';
import { nowSec } from './time';

/** Authorization: Bearer <hex> → user. app.py _token ile birebir. */
export function bearerToken(req: Request): string | null {
  const h = req.header('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t || null;
}

/**
 * Bearer token doğrulama guard — app.py user_from_token ile birebir.
 * sessions.token eşleşmeli VE created > now - TOKEN_TTL (90 gün). Geçersiz →
 * 401 {"error":"unauthorized"}. Çözülen kullanıcı req.user'a yazılır.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Session.name) private sessions: Model<Session>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw apiError(401, 'unauthorized');

    const sess = await this.sessions.findOne({ token }).lean();
    if (!sess || sess.created <= nowSec() - TOKEN_TTL) {
      throw apiError(401, 'unauthorized');
    }
    const user = await this.users.findOne({ id: sess.user_id }).lean();
    if (!user) throw apiError(401, 'unauthorized');

    (req as any).user = user;
    return true;
  }
}
