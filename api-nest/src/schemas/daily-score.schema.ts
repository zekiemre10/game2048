import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DailyScoreDocument = HydratedDocument<DailyScore>;

/** daily_scores (app.py:493-502). PK (day, user_id). */
@Schema({ collection: 'daily_scores' })
export class DailyScore {
  @Prop({ required: true, index: true })
  day: string; // YYYY-MM-DD (UTC)

  @Prop({ required: true })
  user_id: number;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true, default: 0 })
  score: number;

  @Prop({ required: true, default: 0 })
  best: number; // en büyük kare

  @Prop({ required: true, default: 0 })
  moves: number;

  @Prop({ required: true })
  updated: number;
}

export const DailyScoreSchema = SchemaFactory.createForClass(DailyScore);
DailyScoreSchema.index({ day: 1, user_id: 1 }, { unique: true });
DailyScoreSchema.index({ day: 1, score: -1, best: -1, updated: 1 });
