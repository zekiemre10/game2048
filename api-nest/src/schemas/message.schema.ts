import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

/** messages (app.py:428-434). Arkadaşlar arası sohbet. */
@Schema({ collection: 'messages' })
export class Message {
  @Prop({ required: true, unique: true, index: true })
  id: number; // eski sqlite messages.id — /messages?after= bu id'ye göre

  @Prop({ required: true, index: true })
  from_id: number;

  @Prop({ required: true, index: true })
  to_id: number;

  @Prop({ required: true })
  body: string;

  @Prop({ required: true })
  created: number;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
