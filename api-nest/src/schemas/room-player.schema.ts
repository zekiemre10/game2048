import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoomPlayerDocument = HydratedDocument<RoomPlayer>;

/**
 * room_players (app.py:445-455). UNIQUE(code, user_id).
 * user_id < 0 → bot. `level` = bot anahtarı (difficulty VEYA character);
 * insanlarda null. Skor MAX() ile yazılır (geç/sırasız poll düşüremez).
 */
@Schema({ collection: 'room_players' })
export class RoomPlayer {
  @Prop({ required: true, index: true })
  code: string;

  @Prop({ required: true })
  user_id: number; // negatif → bot

  @Prop({ required: true })
  username: string;

  @Prop({ type: String, default: null })
  level: string | null; // bot: difficulty|character; insan: null

  @Prop({ required: true, default: 0 })
  score: number;

  @Prop({ required: true, default: 0 })
  best: number;

  @Prop({ required: true, default: 0 })
  done: number; // 0 | 1

  @Prop({ required: true })
  joined: number;
}

export const RoomPlayerSchema = SchemaFactory.createForClass(RoomPlayer);
RoomPlayerSchema.index({ code: 1, user_id: 1 }, { unique: true });
