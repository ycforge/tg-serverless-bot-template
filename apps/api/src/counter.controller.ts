import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { CounterService } from './counters';
import { TgAuth, TgAuthor } from './telegram/telegram-auth.decorators';
import { TelegramUser } from './telegram/telegram-auth.types';

interface ChangeCounterBody {
  operationId?: unknown;
  delta?: unknown;
}

@Controller('api')
@TgAuth()
export class CounterController {
  constructor(private readonly counters: CounterService) {}

  @Get('counter')
  @Header('Cache-Control', 'no-store')
  read(@TgAuthor() user: TelegramUser) {
    return this.counters.read(user.id);
  }

  @Post('counter/change')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  change(@TgAuthor() user: TelegramUser, @Body() body: ChangeCounterBody | null) {
    if (!body || (body.delta !== 1 && body.delta !== -1) || typeof body.operationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId)) {
      throw new BadRequestException('Expected delta (+1/-1) and UUID v4 operationId');
    }
    return this.counters.change(user.id, body.operationId, body.delta);
  }
}
