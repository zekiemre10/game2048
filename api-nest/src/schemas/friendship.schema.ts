import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

/** friendships (app.py:420-427). UNIQUE(requester_id, addressee_id). */
@Schema({ collection: 'friendships' })
export class Friendship {
  @Prop({ required: true, unique: true, index: true })
  id: number; // eski sqlite friendships.id — /friends/respond bu id'yi kullanır

  @Prop({ required: true, index: true })
  requester_id: number;

  @Prop({ required: true, index: true })
  addressee_id: number;

  @Prop({ required: true, default: 'pending' })
  status: string; // pending | accepted

  @Prop({ required: true })
  created: number;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);
FriendshipSchema.index({ requester_id: 1, addressee_id: 1 }, { unique: true });
