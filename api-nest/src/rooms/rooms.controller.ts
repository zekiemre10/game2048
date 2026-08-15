import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';

/** Çok oyunculu odalar — app.py birebir. Hepsi Bearer korumalı. */
@Controller('rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private rooms: RoomsService) {}

  @Post('create')
  create(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.create(me, body);
  }

  @Post('join')
  join(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.join(me, body);
  }

  @Post('leave')
  leave(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.leave(me, body);
  }

  @Post('start')
  start(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.start(me, body);
  }

  @Post('progress')
  progress(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.progress(me, body);
  }

  @Post('addbot')
  addBot(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.addBot(me, body);
  }

  @Post('removebot')
  removeBot(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.rooms.removeBot(me, body);
  }

  @Get('state')
  state(@CurrentUser() me: AuthUser, @Query('code') code: string) {
    return this.rooms.state(me, code);
  }
}
