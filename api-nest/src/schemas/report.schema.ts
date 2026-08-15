import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

/** reports (app.py:504-512). Kullanıcı şikayetleri (moderasyon). */
@Schema({ collection: 'reports' })
export class Report {
  @Prop({ required: true, unique: true, index: true })
  id: number; // eski sqlite reports.id

  @Prop({ required: true })
  reporter_id: number;

  @Prop({ required: true })
  target_id: number;

  @Prop({ required: true })
  reason: string; // spam | harassment | cheating | other

  @Prop({ type: String, default: null })
  detail: string | null;

  @Prop({ type: String, default: null })
  context: string | null;

  @Prop({ required: true })
  created: number;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
