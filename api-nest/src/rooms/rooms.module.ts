import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from '../schemas/room.schema';
import { RoomPlayer, RoomPlayerSchema } from '../schemas/room-player.schema';
import { FlaggedSubmission, FlaggedSubmissionSchema } from '../schemas/flagged-submission.schema';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { BotTimelineService } from './bot-timeline.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: RoomPlayer.name, schema: RoomPlayerSchema },
      { name: FlaggedSubmission.name, schema: FlaggedSubmissionSchema },
    ]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, BotTimelineService],
  exports: [RoomsService],
})
export class RoomsModule {}
