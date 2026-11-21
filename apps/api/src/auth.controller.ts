import { Controller, Header, HttpCode, Post } from '@nestjs/common';
import { TgAuth, TgContext } from './telegram/telegram-auth.decorators';
import { TelegramAuthContext, toPublicTelegramUser } from './telegram/telegram-auth.types';

@Controller('api')
export class AuthController {
  @Post('auth/telegram')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @TgAuth()
  login(@TgContext() context: TelegramAuthContext) {
    return { user: toPublicTelegramUser(context.user) };
  }
}
