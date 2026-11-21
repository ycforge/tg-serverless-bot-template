import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInitData } from '../apps/api/src/telegram/init-data';
import {
  DEFAULT_FUTURE_SKEW_SECONDS,
  DEFAULT_MAX_AGE_SECONDS,
  toPublicTelegramUser,
} from '../apps/api/src/telegram/telegram-auth.types';
import {
  resolveTelegramAuthConfig,
  TelegramAuthService,
} from '../apps/api/src/telegram/telegram-auth.service';
import { fields, now, signed, signedUser, token } from './telegram-fixtures';

test('validates signed Telegram identity including the signature field', () => {
  const context = validateInitData(signed(fields()), token, now);
  assert.equal(context.user.id, '123456789');
  assert.equal(context.user.firstName, 'Тест');
  assert.equal(context.user.username, 'tester');
  assert.equal(context.authDate, now);
  assert.equal(context.chat, undefined);
});

test('rejects a changed user ID and a different bot token', () => {
  assert.throws(() => validateInitData(signed(fields()).replace('123456789', '987654321'), token, now));
  assert.throws(() => validateInitData(signed(fields()), 'different-token', now));
});

test('rejects expired, future, empty and duplicate auth data', () => {
  assert.throws(() => validateInitData(signed(fields()), token, now + 3601));
  assert.throws(() => validateInitData(signed(fields({ auth_date: String(now + 60) })), token, now));
  assert.throws(() => validateInitData('', token, now));
  assert.throws(() => validateInitData(signed(fields()) + '&auth_date=1', token, now));
});

test('supports configurable max age and future skew', () => {
  const options = { now, maxAgeSeconds: 60, futureSkewSeconds: 5 };
  assert.equal(validateInitData(signed(fields()), token, options).user.id, '123456789');
  assert.equal(validateInitData(signed(fields({ auth_date: String(now + 5) })), token, options).authDate, now + 5);
  assert.throws(() => validateInitData(signed(fields({ auth_date: String(now - 61) })), token, options));
  assert.throws(() => validateInitData(signed(fields({ auth_date: String(now + 6) })), token, options));
});

test('rejects invalid auth configuration and a missing bot token', () => {
  assert.throws(() => validateInitData(signed(fields()), token, { now, maxAgeSeconds: 0 }), /max age/);
  assert.throws(() => validateInitData(signed(fields()), token, { now, futureSkewSeconds: -1 }), /future skew/);
  assert.throws(() => validateInitData(signed(fields()), '', now), /BOT_TOKEN/);
});

test('keeps the signed user and receiver separate', () => {
  const receiver = { id: 987654321, first_name: 'Receiver', username: 'receiver' };
  const context = validateInitData(signed(fields({ receiver: JSON.stringify(receiver) })), token, now);
  assert.equal(context.user.id, '123456789');
  assert.equal(context.receiver?.id, '987654321');
  assert.equal(context.receiver?.firstName, 'Receiver');
  assert.notEqual(context.user.id, context.receiver?.id);
});

test('does not synthesize a chat when the signed chat is absent', () => {
  const context = validateInitData(signed(fields()), token, now);
  assert.equal(context.chat, undefined);
  assert.equal(context.chatType, undefined);
});

test('normalizes an optional signed chat including a negative chat ID', () => {
  const chat = { id: -1001234567890, type: 'supergroup', title: 'Group' };
  const context = validateInitData(signed(fields({
    chat: JSON.stringify(chat),
    chat_type: 'supergroup',
    chat_instance: 'instance-1',
    query_id: 'query-1',
    start_param: 'start-1',
  })), token, now);
  assert.equal(context.chat?.id, '-1001234567890');
  assert.equal(context.chat?.type, 'supergroup');
  assert.equal(context.chat?.title, 'Group');
  assert.equal(context.chatType, 'supergroup');
  assert.equal(context.chatInstance, 'instance-1');
  assert.equal(context.queryId, 'query-1');
  assert.equal(context.startParam, 'start-1');
});

test('rejects malformed optional signed objects instead of silently trusting them', () => {
  assert.throws(() => validateInitData(signed(fields({ receiver: JSON.stringify({ id: 'bad' }) })), token, now));
  assert.throws(() => validateInitData(signed(fields({ receiver: 'null' })), token, now));
  assert.throws(() => validateInitData(signed(fields({ chat: JSON.stringify({ id: 0, type: 'private' }) })), token, now));
  assert.throws(() => validateInitData(signed(fields({ chat: JSON.stringify({ id: 1 }) })), token, now));
  assert.throws(() => validateInitData(signed(fields({ chat: '{not-json' })), token, now));
});

test('rejects malformed and unsafe user IDs', () => {
  for (const id of ['123', 1.5, -1, 0, null]) {
    assert.throws(() => validateInitData(signed(fields({ user: JSON.stringify({ id }) })), token, now));
  }
  assert.throws(() => validateInitData(signed(fields({ user: '{}' })), token, now));
  assert.throws(() => validateInitData(signed(fields({ user: 'null' })), token, now));
});

test('requires a valid auth_date', () => {
  const withoutDate = fields();
  delete withoutDate.auth_date;
  assert.throws(() => validateInitData(signed(withoutDate), token, now));
  assert.throws(() => validateInitData(signed(fields({ auth_date: 'not-a-number' })), token, now));
  assert.throws(() => validateInitData(signed(fields({ auth_date: '0' })), token, now));
  assert.throws(() => validateInitData(signed(fields({ auth_date: '1e3' })), token, now));
});

test('rejects missing, malformed and oversized initData', () => {
  const good = signed(fields());
  assert.throws(() => validateInitData(good.replace(/&signature=[^&]+/, ''), token, now));
  assert.throws(() => validateInitData(good.replace(/hash=[0-9a-f]+/i, 'hash=abc'), token, now));
  assert.throws(() => validateInitData(good.replace(/&hash=[0-9a-f]+/i, ''), token, now));
  assert.throws(() => validateInitData('x'.repeat(16385), token, now));
});

test('exposes only the backward-compatible public user fields', () => {
  const context = validateInitData(signed(fields({
    user: JSON.stringify({ ...signedUser, last_name: 'И', is_premium: true }),
  })), token, now);
  assert.deepEqual(toPublicTelegramUser(context.user), {
    id: '123456789',
    firstName: 'Тест',
    username: 'tester',
  });
});

test('resolves secure defaults and validates auth environment values', () => {
  assert.deepEqual(resolveTelegramAuthConfig({ botToken: 'x' }, {}), {
    botToken: 'x',
    maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
    futureSkewSeconds: DEFAULT_FUTURE_SKEW_SECONDS,
  });
  assert.deepEqual(resolveTelegramAuthConfig({}, {
    BOT_TOKEN: 'env-token',
    TELEGRAM_AUTH_MAX_AGE_SECONDS: '120',
    TELEGRAM_AUTH_FUTURE_SKEW_SECONDS: '5',
  }), {
    botToken: 'env-token',
    maxAgeSeconds: 120,
    futureSkewSeconds: 5,
  });
  assert.throws(() => resolveTelegramAuthConfig({}, {}), /BOT_TOKEN/);
  assert.throws(() => resolveTelegramAuthConfig({ botToken: 'x', maxAgeSeconds: 0 }, {}));
  assert.throws(() => resolveTelegramAuthConfig({ botToken: 'x', futureSkewSeconds: -1 }, {}));
  assert.throws(() => resolveTelegramAuthConfig({ botToken: 'x', maxAgeSeconds: 1.5 }, {}));
});

test('the auth service applies its configured limits', () => {
  const service = new TelegramAuthService({ botToken: token, maxAgeSeconds: 60, futureSkewSeconds: 5 });
  assert.equal(service.validate(signed(fields()), now).user.id, '123456789');
  assert.equal(service.config.maxAgeSeconds, 60);
  assert.throws(() => service.validate(signed(fields({ auth_date: String(now - 61) })), now));
  assert.throws(() => service.validate(signed(fields({ auth_date: String(now + 6) })), now));
});
