import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter } from '../schemas/counter.schema';

/**
 * Sqlite AUTOINCREMENT eşdeğeri. Atomik $inc ile çakışmasız, artan sayısal id.
 * users/friendships/messages/reports için (dış referanslar sayısal id'ye bağlı).
 */
@Injectable()
export class CountersService {
  constructor(@InjectModel(Counter.name) private counters: Model<Counter>) {}

  /** Sonraki id (atomik). Sayaç yoksa 1'den başlar. */
  async next(name: string): Promise<number> {
    const doc = await this.counters.findByIdAndUpdate(
      name,
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return doc!.seq;
  }

  /**
   * Sayacı en az `value`'ya çıkar (göç sonrası: mevcut en büyük id'nin üstünden
   * devam etsin diye). Tekrar çalıştırılabilir.
   */
  async bumpTo(name: string, value: number): Promise<void> {
    await this.counters.findByIdAndUpdate(
      name,
      { $max: { seq: value } },
      { upsert: true },
    );
  }
}
