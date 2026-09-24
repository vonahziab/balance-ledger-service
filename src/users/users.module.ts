import { Module } from '@nestjs/common';
import { BalanceCache } from './balance-cache.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, BalanceCache],
})
export class UsersModule {}
