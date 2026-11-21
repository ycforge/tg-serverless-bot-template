import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import {
  DEFAULT_FUTURE_SKEW_SECONDS,
  DEFAULT_MAX_AGE_SECONDS,
  TelegramAuthContext,
  TelegramChat,
  TelegramInitDataOptions,
  TelegramUser,
} from './telegram-auth.types';

const MAX_INIT_DATA_LENGTH = 16_384;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const AUTH_FAILED = 'Не удалось подтвердить вход через Telegram. Открой приложение заново.';

function deny(): never {
  throw new UnauthorizedException(AUTH_FAILED);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') deny();
  return value;
}

function optionalNonEmptyString(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!value) deny();
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') deny();
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return deny();
  }
}

function positiveUserId(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) deny();
  return String(value);
}

function chatId(value: unknown): string {
  if (!Number.isSafeInteger(value) || value === 0) deny();
  return String(value);
}

function normalizeUser(value: unknown): TelegramUser {
  if (!isRecord(value)) deny();
  const id = positiveUserId(value.id);
  const firstName = optionalString(value.first_name) ?? '';
  const username = optionalString(value.username) ?? '';
  const lastName = optionalString(value.last_name);
  const languageCode = optionalString(value.language_code);
  const isPremium = optionalBoolean(value.is_premium);
  const isBot = optionalBoolean(value.is_bot);
  const photoUrl = optionalString(value.photo_url);
  return {
    id,
    firstName,
    username,
    ...(lastName !== undefined ? { lastName } : {}),
    ...(languageCode !== undefined ? { languageCode } : {}),
    ...(isPremium !== undefined ? { isPremium } : {}),
    ...(isBot !== undefined ? { isBot } : {}),
    ...(photoUrl !== undefined ? { photoUrl } : {}),
  };
}

function normalizeChat(value: unknown): TelegramChat {
  if (!isRecord(value)) deny();
  const id = chatId(value.id);
  const type = optionalString(value.type);
  if (!type) deny();
  const title = optionalString(value.title);
  const username = optionalString(value.username);
  return {
    id,
    type,
    ...(title !== undefined ? { title } : {}),
    ...(username !== undefined ? { username } : {}),
  };
}

function parseAuthDate(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) deny();
  const authDate = Number(value);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) deny();
  return authDate;
}

function resolveOptions(nowOrOptions: number | TelegramInitDataOptions): Required<TelegramInitDataOptions> {
  const options = typeof nowOrOptions === 'number' ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const futureSkewSeconds = options.futureSkewSeconds ?? DEFAULT_FUTURE_SKEW_SECONDS;
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Telegram auth clock');
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('Invalid Telegram auth max age');
  }
  if (!Number.isSafeInteger(futureSkewSeconds) || futureSkewSeconds < 0) {
    throw new Error('Invalid Telegram auth future skew');
  }
  return { now, maxAgeSeconds, futureSkewSeconds };
}

export function validateInitData(
  raw: string,
  botToken: string,
  nowOrOptions: number | TelegramInitDataOptions = {},
): TelegramAuthContext {
  if (!botToken) throw new Error('BOT_TOKEN is not configured');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INIT_DATA_LENGTH) deny();

  const options = resolveOptions(nowOrOptions);
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) deny();

  const hash = params.get('hash');
  if (!hash || !HASH_PATTERN.test(hash)) deny();
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const provided = Buffer.from(hash, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) deny();

  const authDate = parseAuthDate(params.get('auth_date'));
  if (authDate > options.now + options.futureSkewSeconds) deny();
  if (options.now - authDate > options.maxAgeSeconds) deny();

  const userValue = params.get('user');
  if (userValue === null) deny();
  const user = normalizeUser(parseJson(userValue));

  const receiverValue = params.get('receiver');
  const receiver = receiverValue === null ? undefined : normalizeUser(parseJson(receiverValue));

  const chatValue = params.get('chat');
  const chat = chatValue === null ? undefined : normalizeChat(parseJson(chatValue));

  const chatType = optionalNonEmptyString(params.get('chat_type'));
  const chatInstance = optionalNonEmptyString(params.get('chat_instance'));
  const queryId = optionalNonEmptyString(params.get('query_id'));
  const startParam = optionalNonEmptyString(params.get('start_param'));

  return {
    user,
    ...(receiver !== undefined ? { receiver } : {}),
    ...(chat !== undefined ? { chat } : {}),
    ...(chatType !== undefined ? { chatType } : {}),
    ...(chatInstance !== undefined ? { chatInstance } : {}),
    ...(queryId !== undefined ? { queryId } : {}),
    ...(startParam !== undefined ? { startParam } : {}),
    authDate,
  };
}
