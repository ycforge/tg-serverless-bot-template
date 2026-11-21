import { DynamicModule, Module } from '@nestjs/common';
import { TelegramAuthGuard } from './telegram-auth.guard';
import {
  TELEGRAM_AUTH_OPTIONS,
  TelegramAuthModuleOptions,
  TelegramAuthService,
} from './telegram-auth.service';

@Module({})
export class TelegramAuthModule {
  static forRoot(options: TelegramAuthModuleOptions = {}): DynamicModule {
    return {
      module: TelegramAuthModule,
      providers: [
        { provide: TELEGRAM_AUTH_OPTIONS, useValue: options },
        TelegramAuthService,
        TelegramAuthGuard,
      ],
      exports: [TelegramAuthService, TelegramAuthGuard],
    };
  }
}
