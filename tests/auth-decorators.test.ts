import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../apps/api/src/auth.controller';
import { CounterController } from '../apps/api/src/counter.controller';
import { TgAuth, TgAuthor, TgChat, TgContext, TgReceiver, TgUser } from '../apps/api/src/telegram/telegram-auth.decorators';
import { TelegramAuthGuard } from '../apps/api/src/telegram/telegram-auth.guard';
import { TelegramAuthService } from '../apps/api/src/telegram/telegram-auth.service';
import {
  TelegramAuthContext,
  TelegramHttpRequest,
  getTelegramAuth,
  setTelegramAuth,
} from '../apps/api/src/telegram/telegram-auth.types';
import { liveFields, signed, token } from './telegram-fixtures';

class DecoratedController {
  user(@TgUser() user: unknown) {
    return user;
  }

  author(@TgAuthor() author: unknown) {
    return author;
  }

  receiver(@TgReceiver() receiver: unknown) {
    return receiver;
  }

  chat(@TgChat() chat: unknown) {
    return chat;
  }

  requiredChat(@TgChat({ required: true }) chat: unknown) {
    return chat;
  }

  context(@TgContext() context: unknown) {
    return context;
  }
}

interface ParamMetadata {
  factory: (data: unknown, context: ExecutionContext) => unknown;
}

function paramFactory(target: object, method: string): (data: unknown, context: ExecutionContext) => unknown {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, target, method) as Record<string, ParamMetadata>;
  return Object.values(metadata)[0].factory;
}

function httpContext(request: TelegramHttpRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function authContext(overrides: Partial<TelegramAuthContext> = {}): TelegramAuthContext {
  return {
    user: { id: '123', firstName: 'Test', username: 'tester' },
    authDate: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

test('parameter decorators fail closed when no verified guard context exists', () => {
  const context = httpContext({});
  for (const method of ['user', 'author', 'receiver', 'chat', 'requiredChat', 'context']) {
    assert.throws(() => paramFactory(DecoratedController, method)(undefined, context), UnauthorizedException);
  }
});

test('caller supplied JSON cannot provide auth context to decorators', () => {
  const request: TelegramHttpRequest & { body?: unknown } = {
    body: { telegramUser: { id: '999' }, telegramAuth: authContext({ user: { id: '999', firstName: '', username: '' } }) },
  };
  assert.throws(() => paramFactory(DecoratedController, 'user')(undefined, httpContext(request)), UnauthorizedException);
});

test('TgUser, TgAuthor and TgContext read only the verified request context', () => {
  const auth = authContext();
  const request: TelegramHttpRequest = {};
  setTelegramAuth(request, auth);
  const context = httpContext(request);
  assert.deepEqual(paramFactory(DecoratedController, 'user')(undefined, context), auth.user);
  assert.deepEqual(paramFactory(DecoratedController, 'author')(undefined, context), auth.user);
  assert.deepEqual(paramFactory(DecoratedController, 'context')(undefined, context), auth);
  assert.equal(Object.keys(request).includes('telegramAuth'), false);
});

test('TgChat is optional by default and explicitly required when requested', () => {
  const request: TelegramHttpRequest = {};
  setTelegramAuth(request, authContext());
  const context = httpContext(request);
  assert.equal(paramFactory(DecoratedController, 'chat')(undefined, context), undefined);
  assert.throws(
    () => paramFactory(DecoratedController, 'requiredChat')({ required: true }, context),
    BadRequestException,
  );

  const chat = { id: '-100123', type: 'supergroup' };
  const withChat: TelegramHttpRequest = {};
  setTelegramAuth(withChat, authContext({ chat }));
  assert.deepEqual(paramFactory(DecoratedController, 'chat')(undefined, httpContext(withChat)), chat);
});

test('guard verifies initData and stores a private per-request context', () => {
  const guard = new TelegramAuthGuard(new TelegramAuthService({ botToken: token }));
  const first: TelegramHttpRequest = { headers: { authorization: `tma ${signed(liveFields())}` } };
  const second: TelegramHttpRequest = {
    headers: { authorization: `tma ${signed(liveFields({ user: JSON.stringify({ id: 456, first_name: 'Second' }) }))}` },
  };

  assert.equal(guard.canActivate(httpContext(first)), true);
  assert.equal(guard.canActivate(httpContext(second)), true);
  assert.equal(getTelegramAuth(first)?.user.id, '123456789');
  assert.equal(getTelegramAuth(second)?.user.id, '456');
  assert.notEqual(getTelegramAuth(first), getTelegramAuth(second));
});

test('guard rejects missing, malformed and tampered authorization', () => {
  const guard = new TelegramAuthGuard(new TelegramAuthService({ botToken: token }));
  assert.throws(() => guard.canActivate(httpContext({})), UnauthorizedException);
  assert.throws(() => guard.canActivate(httpContext({ headers: { authorization: 'Bearer token' } })), UnauthorizedException);
  assert.throws(
    () => guard.canActivate(httpContext({ headers: { authorization: 'tma' } })),
    UnauthorizedException,
  );
  const tampered = signed(liveFields()).replace('123456789', '987654321');
  assert.throws(
    () => guard.canActivate(httpContext({ headers: { authorization: `tma ${tampered}` } })),
    UnauthorizedException,
  );
});

test('guard rejects ambiguous headers and clears identity after failed revalidation', () => {
  const guard = new TelegramAuthGuard(new TelegramAuthService({ botToken: token }));
  const authorization = `tma ${signed(liveFields())}`;
  for (const headers of [
    { authorization: [authorization] },
    { authorization, Authorization: authorization },
  ]) {
    assert.throws(() => guard.canActivate(httpContext({ headers })), UnauthorizedException);
  }
  const request: TelegramHttpRequest = { headers: { AUTHORIZATION: authorization } };
  assert.equal(guard.canActivate(httpContext(request)), true);
  request.headers = { authorization: 'Bearer invalid' };
  assert.throws(() => guard.canActivate(httpContext(request)), UnauthorizedException);
  assert.equal(getTelegramAuth(request), undefined);
  assert.throws(() => paramFactory(DecoratedController, 'author')(undefined, httpContext(request)), UnauthorizedException);
});

test('verified context is immutable and receiver is distinct from author', () => {
  const request: TelegramHttpRequest = {};
  const receiver = { id: '456', firstName: 'Receiver', username: '' };
  setTelegramAuth(request, authContext({ receiver, chat: { id: '-100123', type: 'supergroup' } }));
  const context = getTelegramAuth(request)!;
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.user));
  assert.ok(Object.isFrozen(context.receiver));
  assert.ok(Object.isFrozen(context.chat));
  assert.equal(paramFactory(DecoratedController, 'receiver')(undefined, httpContext(request)), receiver);
  assert.notEqual(context.user.id, receiver.id);
});

test('auth service refuses to start without a bot token', () => {
  assert.throws(() => new TelegramAuthService({ botToken: '' }), /BOT_TOKEN/);
});

test('TgAuth is applied at controller and method level with no-store responses', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CounterController), [TelegramAuthGuard]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.login), [TelegramAuthGuard]);

  for (const [target, method] of [
    [AuthController.prototype.login, 'login'],
    [CounterController.prototype.read, 'read'],
    [CounterController.prototype.change, 'change'],
  ] as const) {
    const headers = Reflect.getMetadata(HEADERS_METADATA, target) as Array<{ name: string; value: string }>;
    assert.ok(headers.some((header) => header.name === 'Cache-Control' && header.value === 'no-store'), method);
  }
});

test('TgAuth applies the guard decorator metadata', () => {
  class GuardedController {
    @TgAuth()
    handler() {
      return undefined;
    }
  }
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, GuardedController.prototype.handler), [TelegramAuthGuard]);
});
