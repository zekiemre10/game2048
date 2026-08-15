import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlaggedSubmissionDocument = HydratedDocument<FlaggedSubmission>;

/**
 * flagged_submissions (app.py:481-492). Uydurma/tutarsız skor denemeleri.
 * Kabul edilmez ama GÖZLENİR (kanıt). endpoint: monthly|daily|room.
 */
@Schema({ collection: 'flagged_submissions' })
export class FlaggedSubmission {
  @Prop({ required: true })
  user_id: number;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  endpoint: string; // monthly | daily | room

  @Prop({ required: true })
  reason: string; // invalid_replay | claimed_mismatch | missing_transcript | bad_size | too_long

  @Prop({ type: Number, default: null })
  claimed_score: number | null;

  @Prop({ type: Number, default: null })
  computed_score: number | null;

  @Prop({ type: Number, default: null })
  moves: number | null;

  @Prop({ type: Number, default: null })
  seed: number | null;

  @Prop({ required: true })
  created: number;
}

export const FlaggedSubmissionSchema = SchemaFactory.createForClass(FlaggedSubmission);
