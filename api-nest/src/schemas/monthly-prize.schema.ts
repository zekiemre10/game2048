import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MonthlyPrizeDocument = HydratedDocument<MonthlyPrize>;

/** monthly_prizes (app.py:470-477). Ay başına tek şampiyon. PK month. */
@Schema({ collection: 'monthly_prizes' })
export class MonthlyPrize {
  @Prop({ required: true, unique: true, index: true })
  month: string; // YYYY-MM

  @Prop({ required: true })
  user_id: number;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  score: number;

  @Prop({ required: true, default: 0 })
  claimed: number; // 0 | 1

  @Prop({ required: true })
  created: number;
}

export const MonthlyPrizeSchema = SchemaFactory.createForClass(MonthlyPrize);
