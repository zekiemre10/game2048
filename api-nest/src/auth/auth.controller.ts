import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { clientIp } from '../common/ip';
import { bearerToken } from '../common/auth.guard';

/** /register /login /logout — hepsi public (guard yok; auth burada kurulur). */
@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() body: any, @Req() req: Request) {
    return this.auth.register(body, clientIp(req));
  }

  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body);
  }

  @Post('logout')
  logout(@Req() req: Request) {
    // app.py: geçerlilik değil, VARLIK kontrolü — jeton yoksa 401.
    return this.auth.logout(bearerToken(req));
  }
}
