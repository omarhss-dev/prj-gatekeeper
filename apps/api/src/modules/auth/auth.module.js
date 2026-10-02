import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, UsersRepository],
})
export class AuthModule {}
