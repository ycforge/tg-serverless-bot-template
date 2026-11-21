import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { CounterController } from './counter.controller';
import { CounterService } from './counters';
import { HealthController } from './health.controller';
import { TelegramAuthModule } from './telegram/telegram-auth.module';

@Module({
  imports: [TelegramAuthModule.forRoot()],
  controllers: [HealthController, AuthController, CounterController],
  providers: [CounterService],
})
export class AppModule {}
