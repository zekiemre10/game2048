import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ScoresService } from './scores.service';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';

/** Skor tablosu + aylık/günlük — app.py birebir. Hepsi Bearer korumalı. */
@Controller()
@UseGuards(AuthGuard)
export class ScoresController {
  constructor(private scores: ScoresService) {}

  @Get('leaderboard')
  leaderboard(@CurrentUser() me: AuthUser, @Query('scope') scope?: string) {
    return this.scores.leaderboard(me, scope);
  }

  @Post('monthly/submit')
  monthlySubmit(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.scores.monthlySubmit(me, body);
  }

  @Post('monthly/claim')
  monthlyClaim(@CurrentUser() me: AuthUser) {
    return this.scores.monthlyClaim(me);
  }

  @Get('daily')
  daily(@CurrentUser() me: AuthUser) {
    return this.scores.dailyInfo(me);
  }

  @Post('daily/submit')
  dailySubmit(@CurrentUser() me: AuthUser, @Body() body: any) {
    return this.scores.dailySubmit(me, body);
  }
}
