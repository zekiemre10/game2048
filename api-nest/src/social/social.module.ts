import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Friendship, FriendshipSchema } from '../schemas/friendship.schema';
import { Message, MessageSchema } from '../schemas/message.schema';
import { Report, ReportSchema } from '../schemas/report.schema';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
  ],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}
