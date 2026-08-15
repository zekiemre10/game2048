import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * users tablosu (app.py:405-413 + email ALTER).
 * `id` = eski sqlite AUTOINCREMENT tam sayısı; Mongo'da da KORUNUR (istemci
 * ve friendships/messages bu sayısal id'ye bağlı). _id ayrıca ObjectId olur.
 */
@Schema({ collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true })
  id: number; // eski sqlite users.id — dış referanslar buna bağlı

  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true, unique: true, index: true })
  username_lower: string;

  @Prop({ required: true })
  pwhash: string;

  @Prop({ required: true })
  salt: string;

  @Prop({ required: true, default: '{}' })
  data: string; // JSON ilerleme kaydı (achievements/gold/bestScore...)

  @Prop({ required: true })
  created: number; // Unix saniye

  @Prop({ type: String, default: null })
  email: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
