import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_FUTURE_SKEW_SECONDS,
  DEFAULT_MAX_AGE_SECONDS,
  TelegramAuthConfig,
  TelegramAuthContext,
} from './telegram-auth.types';
import { validateInitData } from './init-data';

export const TELEGRAM_AUTH_OPTIONS = Symbol('telegram.auth.options');

export type TelegramAuthModuleOptions = Partial<TelegramAuthConfig>;

type AuthEnvironment = Record<string, string | undefined>;

function parseSeconds(
  value: number | string | undefined,
  fallback: number,
  name: string,
  allowZero: boolean,
): number {
  if (value === undefined || value === '') return fallback;
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid ${name}: expected ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return seconds;
}

export function resolveTelegramAuthConfig(
  options: TelegramAuthModuleOptions = {},
  env: AuthEnvironment = process.env,
): TelegramAuthConfig {
  const botToken = options.botToken ?? env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN is not configured');
  const maxAgeSeconds = parseSeconds(
    options.maxAgeSeconds ?? env.TELEGRAM_AUTH_MAX_AGE_SECONDS,
    DEFAULT_MAX_AGE_SECONDS,
    'TELEGRAM_AUTH_MAX_AGE_SECONDS',
    false,
  );
  const futureSkewSeconds = parseSeconds(
    options.futureSkewSeconds ?? env.TELEGRAM_AUTH_FUTURE_SKEW_SECONDS,
    DEFAULT_FUTURE_SKEW_SECONDS,
    'TELEGRAM_AUTH_FUTURE_SKEW_SECONDS',
    true,
  );
  return Object.freeze({ botToken, maxAgeSeconds, futureSkewSeconds });
}

@Injectable()
export class TelegramAuthService {
  readonly config: TelegramAuthConfig;

  constructor(@Optional() @Inject(TELEGRAM_AUTH_OPTIONS) options?: TelegramAuthModuleOptions) {
    this.config = resolveTelegramAuthConfig(options ?? {});
  }

  validate(raw: string, now = Math.floor(Date.now() / 1000)): TelegramAuthContext {
    return validateInitData(raw, this.config.botToken, {
      now,
      maxAgeSeconds: this.config.maxAgeSeconds,
      futureSkewSeconds: this.config.futureSkewSeconds,
    });
  }
}
