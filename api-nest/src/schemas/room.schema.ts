import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

/** rooms (app.py:436-444). PK code. status: lobby|racing|finished. */
@Schema({ collection: 'rooms' })
export class Room {
  @Prop({ required: true, unique: true, index: true })
  code: string;

  @Prop({ required: true })
  host_id: number;

  @Prop({ required: true, default: 'lobby' })
  status: string; // lobby | racing | finished

  @Prop({ required: true })
  seed: number;

  @Prop({ required: true, default: 180 })
  duration: number;

  @Prop({ type: Number, default: null })
  started_at: number | null;

  @Prop({ required: true })
  created: number;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
