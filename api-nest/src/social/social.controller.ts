import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SocialService } from './social.service';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';

/** Arkadaşlar + sohbet + şikayet — app.py birebir. Hepsi Bearer korumalı. */
@Controller()
@UseGuards(AuthGuard)
export class SocialController {
  constructor(private social: SocialService) {}

  @Get('users/search')
  search(@CurrentUser() me: AuthUser, @Query('q') q?: string) {
    return this.social.search(me, q);
  }

  @Post('friends/request')
  friendRequest(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.social.friendRequest(me, body);
  }

  @Post('friends/respond')
  friendRespond(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.social.friendRespond(me, body);
  }

  @Post('friends/remove')
  friendRemove(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.social.friendRemove(me, body);
  }

  @Get('friends')
  friends(@CurrentUser() me: AuthUser) {
    return this.social.friendsList(me);
  }

  @Post('messages')
  messageSend(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.social.messageSend(me, body);
  }

  @Get('messages')
  messagesList(@CurrentUser() me: AuthUser, @Query('with') withId?: string, @Query('after') after?: string) {
    return this.social.messagesList(me, withId, after);
  }

  @Get('messages/overview')
  messagesOverview(@CurrentUser() me: AuthUser) {
    return this.social.messagesOverview(me);
  }

  @Post('report')
  report(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.social.report(me, body);
  }
}
