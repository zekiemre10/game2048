import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonthlyScore, MonthlyScoreSchema } from '../schemas/monthly-score.schema';
import { DailyScore, DailyScoreSchema } from '../schemas/daily-score.schema';
import { MonthlyPrize, MonthlyPrizeSchema } from '../schemas/monthly-prize.schema';
import { FlaggedSubmission, FlaggedSubmissionSchema } from '../schemas/flagged-submission.schema';
import { Friendship, FriendshipSchema } from '../schemas/friendship.schema';
import { ScoresController } from './scores.controller';
import { ScoresService } from './scores.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MonthlyScore.name, schema: MonthlyScoreSchema },
      { name: DailyScore.name, schema: DailyScoreSchema },
      { name: MonthlyPrize.name, schema: MonthlyPrizeSchema },
      { name: FlaggedSubmission.name, schema: FlaggedSubmissionSchema },
      { name: Friendship.name, schema: FriendshipSchema },
    ]),
  ],
  controllers: [ScoresController],
  providers: [ScoresService],
  exports: [ScoresService],
})
export class ScoresModule {}
