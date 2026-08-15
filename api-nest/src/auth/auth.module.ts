import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersController } from '../users/users.controller';

/**
 * Auth + kullanıcı (kimlik) modülü: /register /login /logout /me /sync.
 * User/Session/Counter modelleri @Global CommonModule'dan gelir.
 */
@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
