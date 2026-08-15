import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * counters — sqlite AUTOINCREMENT eşdeğeri. Mongo'da sıralı sayısal id
 * üretmek için (users/friendships/messages/reports). Atomik $inc ile.
 * `_id` = sayaç adı ("users" | "friendships" | "messages" | "reports").
 */
@Schema({ collection: 'counters', _id: false })
export class Counter {
  @Prop({ required: true })
  _id: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
