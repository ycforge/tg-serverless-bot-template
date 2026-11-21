import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TelegramAuthService } from './telegram-auth.service';
import { TELEGRAM_AUTH, TelegramHttpRequest, setTelegramAuth } from './telegram-auth.types';

const AUTH_REQUIRED = 'Telegram authorization required';

function readAuthorization(request: TelegramHttpRequest): string | undefined {
  const entries = Object.entries(request.headers ?? {})
    .filter(([name]) => name.toLowerCase() === 'authorization');
  if (entries.length !== 1) return undefined;
  const value = entries[0][1];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private readonly telegramAuth: TelegramAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TelegramHttpRequest>();
    // A failed revalidation must never leave a previously verified identity behind.
    delete request[TELEGRAM_AUTH];
    const authorization = readAuthorization(request);
    const match = authorization ? /^tma\s+(.+)$/is.exec(authorization.trim()) : null;
    if (!match) throw new UnauthorizedException(AUTH_REQUIRED);
    setTelegramAuth(request, this.telegramAuth.validate(match[1]));
    return true;
  }
}
