import {
  BadRequestException,
  ExecutionContext,
  applyDecorators,
  createParamDecorator,
  UseGuards,
} from '@nestjs/common';
import { TelegramAuthGuard } from './telegram-auth.guard';
import {
  TelegramAuthContext,
  TelegramChat,
  TelegramUser,
  requireTelegramAuth,
} from './telegram-auth.types';

export function TgAuth() {
  return applyDecorators(UseGuards(TelegramAuthGuard));
}

function requestFrom(context: ExecutionContext): unknown {
  return context.switchToHttp().getRequest();
}

export const TgContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TelegramAuthContext => requireTelegramAuth(requestFrom(context)),
);

export const TgUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TelegramUser => requireTelegramAuth(requestFrom(context)).user,
);

export const TgAuthor = TgUser;

export const TgReceiver = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TelegramUser | undefined => requireTelegramAuth(requestFrom(context)).receiver,
);

export interface TgChatOptions {
  required?: boolean;
}

export const TgChat = createParamDecorator(
  (data: TgChatOptions | undefined, context: ExecutionContext): TelegramChat | undefined => {
    const chat = requireTelegramAuth(requestFrom(context)).chat;
    if (!chat && data?.required) throw new BadRequestException('Chat context is required for this endpoint');
    return chat;
  },
);
