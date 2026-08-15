import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../schemas/user.schema';

/** AuthGuard'ın req.user'a yazdığı doğrulanmış kullanıcı (lean User). */
export type AuthUser = User & { _id: unknown };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
