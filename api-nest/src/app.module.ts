import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { loadConfig } from './config';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { Http200Interceptor } from './common/http200.interceptor';
import { AuthModule } from './auth/auth.module';
import { ScoresModule } from './scores/scores.module';
import { RoomsModule } from './rooms/rooms.module';
import { SocialModule } from './social/social.module';
import { HealthController } from './health.controller';

/**
 * Kök modül. Mongo bağlantısı env'den (test'te mongodb-memory-server uri'si
 * GAME2048_MONGO_URI'ye yazılır). Global hata filtresi app.py zarfını uygular.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => {
        const cfg = loadConfig();
        return { uri: cfg.mongoUri, dbName: cfg.dbName };
      },
    }),
    CommonModule,
    AuthModule,
    ScoresModule,
    RoomsModule,
    SocialModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: Http200Interceptor },
  ],
})
export class AppModule {}
