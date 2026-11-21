import { UnauthorizedException } from '@nestjs/common';

export interface TelegramUser {
  readonly id: string;
  readonly firstName: string;
  readonly username: string;
  readonly lastName?: string;
  readonly languageCode?: string;
  readonly isPremium?: boolean;
  readonly isBot?: boolean;
  readonly photoUrl?: string;
}

export interface TelegramChat {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly username?: string;
}

export interface TelegramAuthContext {
  readonly user: TelegramUser;
  readonly receiver?: TelegramUser;
  readonly chat?: TelegramChat;
  readonly chatType?: string;
  readonly chatInstance?: string;
  readonly queryId?: string;
  readonly startParam?: string;
  readonly authDate: number;
}

export interface TelegramAuthConfig {
  readonly botToken: string;
  readonly maxAgeSeconds: number;
  readonly futureSkewSeconds: number;
}

export interface TelegramInitDataOptions {
  now?: number;
  maxAgeSeconds?: number;
  futureSkewSeconds?: number;
}

export const DEFAULT_MAX_AGE_SECONDS = 3600;
export const DEFAULT_FUTURE_SKEW_SECONDS = 30;

export const TELEGRAM_AUTH = Symbol('telegram.auth');

export interface TelegramHttpRequest {
  headers?: Record<string, string | string[] | undefined>;
  [TELEGRAM_AUTH]?: TelegramAuthContext;
}

export interface PublicTelegramUser {
  id: string;
  firstName: string;
  username: string;
}

export function toPublicTelegramUser(user: TelegramUser): PublicTelegramUser {
  return { id: user.id, firstName: user.firstName, username: user.username };
}

export function getTelegramAuth(request: unknown): TelegramAuthContext | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  return (request as TelegramHttpRequest)[TELEGRAM_AUTH];
}

export function requireTelegramAuth(request: unknown): TelegramAuthContext {
  const context = getTelegramAuth(request);
  if (!context) throw new UnauthorizedException('Telegram authorization required');
  return context;
}

export function setTelegramAuth(request: TelegramHttpRequest, context: TelegramAuthContext): void {
  Object.freeze(context.user);
  if (context.receiver) Object.freeze(context.receiver);
  if (context.chat) Object.freeze(context.chat);
  Object.freeze(context);
  Object.defineProperty(request, TELEGRAM_AUTH, {
    value: context,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}
