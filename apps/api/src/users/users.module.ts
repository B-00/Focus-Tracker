import { Global, Module } from '@nestjs/common';
import { UsersService } from './users.service';

/// Global because Auth and CLI both need it without explicit imports.
@Global()
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
