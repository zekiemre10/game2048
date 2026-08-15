import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

/** sessions tablosu (app.py:414-418). Bearer token → user_id, created=veriliş anı. */
@Schema({ collection: 'sessions' })
export class Session {
  @Prop({ required: true, unique: true, index: true })
  token: string;

  @Prop({ required: true, index: true })
  user_id: number;

  @Prop({ required: true })
  created: number; // TOKEN_TTL bu ana göre uygulanır (90 gün)
}

export const SessionSchema = SchemaFactory.createForClass(Session);
