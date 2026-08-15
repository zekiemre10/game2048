import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MonthlyScoreDocument = HydratedDocument<MonthlyScore>;

/** monthly_scores (app.py:460-468). PK (month, user_id). */
@Schema({ collection: 'monthly_scores' })
export class MonthlyScore {
  @Prop({ required: true, index: true })
  month: string; // YYYY-MM (UTC)

  @Prop({ required: true })
  user_id: number;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true, default: 0 })
  score: number; // ay içi en iyi skor

  @Prop({ required: true, default: 0 })
  best: number; // en büyük kare

  @Prop({ required: true })
  updated: number;
}

export const MonthlyScoreSchema = SchemaFactory.createForClass(MonthlyScore);
MonthlyScoreSchema.index({ month: 1, user_id: 1 }, { unique: true });
MonthlyScoreSchema.index({ month: 1, score: -1, best: -1, updated: 1 });
