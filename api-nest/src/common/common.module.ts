import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../schemas/user.schema';
import { Session, SessionSchema } from '../schemas/session.schema';
import { Counter, CounterSchema } from '../schemas/counter.schema';
import { RateLimitService } from './rate-limit.service';
import { CountersService } from './counters.service';
import { AuthGuard } from './auth.guard';

/**
 * Paylaşılan altyapı: hız sınırlayıcı, sayaç servisi, Bearer guard.
 * @Global → her modül import etmeden AuthGuard/RateLimit/Counters enjekte
 * edebilir. Guard'ın ihtiyacı olan User/Session modelleri burada kayıtlı.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  providers: [RateLimitService, CountersService, AuthGuard],
  exports: [RateLimitService, CountersService, AuthGuard, MongooseModule],
})
export class CommonModule {}
