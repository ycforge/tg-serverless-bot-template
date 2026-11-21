import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { liveFields, signed } from './telegram-fixtures';
const require = createRequire(import.meta.url);
const { handler } = require('../apps/api/dist/index.js');
process.env.BOT_TOKEN = 'local-test-token';
const context = { awsRequestId: 'test-request', functionName: 'test-function', functionVersion: 'v1',
  functionFolderId: 'test-folder', memoryLimitInMB: '512', deadlineMs: Date.now() + 30000, logGroupName: '' };

function event(path: string, method = 'GET', authorization = '') {
  return {
    version: '2.0', rawPath: path, rawQueryString: '', headers: { authorization },
    queryStringParameters: {}, pathParameters: {}, parameters: {}, multiValueParameters: {},
    operationId: 'test', body: '', isBase64Encoded: false,
    requestContext: { authorizer: {}, requestId: 'test-request', time: '', timeEpoch: Date.now(),
      http: { method, path, sourceIp: '127.0.0.1', userAgent: 'test' } },
  };
}

function authorization(overrides: Record<string, string> = {}) {
  return `tma ${signed(liveFields(overrides), process.env.BOT_TOKEN!)}`;
}

test('NestJS adapter serves health and rejects unauthenticated users', async () => {
  const health = await handler(event('/api/health'), context);
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  const denied = await handler(event('/api/counter'), context);
  assert.equal(denied.statusCode, 401);
});

test('NestJS login returns only the backward-compatible verified identity', async () => {
  const response = await handler(event('/api/auth/telegram', 'POST', authorization({
    user: JSON.stringify({ id: 123, first_name: 'Test', username: 'tester', is_premium: true }),
    receiver: JSON.stringify({ id: 999, first_name: 'Receiver' }),
    chat: JSON.stringify({ id: -100123, type: 'supergroup' }),
    chat_type: 'supergroup',
    chat_instance: 'instance',
    query_id: 'query',
    start_param: 'start',
  })), context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    user: { id: '123', firstName: 'Test', username: 'tester' },
  });
});

test('NestJS login keeps different signed users isolated across requests', async () => {
  const first = await handler(event('/api/auth/telegram', 'POST', authorization({
    user: JSON.stringify({ id: 123, first_name: 'First' }),
  })), context);
  const second = await handler(event('/api/auth/telegram', 'POST', authorization({
    user: JSON.stringify({ id: 456, first_name: 'Second' }),
  })), context);
  assert.equal(JSON.parse(first.body).user.id, '123');
  assert.equal(JSON.parse(second.body).user.id, '456');
});

test('NestJS rejects tampered and expired initData', async () => {
  const valid = authorization({ user: JSON.stringify({ id: 123, first_name: 'Test' }) });
  const tampered = await handler(event('/api/auth/telegram', 'POST', valid.replace(
    encodeURIComponent('"id":123'),
    encodeURIComponent('"id":124'),
  )), context);
  assert.equal(tampered.statusCode, 401);

  const expiredAt = String(Math.floor(Date.now() / 1000) - 4000);
  const expired = await handler(event('/api/auth/telegram', 'POST', authorization({ auth_date: expiredAt })), context);
  assert.equal(expired.statusCode, 401);
});

test('NestJS accepts a launch without a signed chat but never synthesizes one', async () => {
  const response = await handler(event('/api/auth/telegram', 'POST', authorization({
    user: JSON.stringify({ id: 123, first_name: 'Test' }),
  })), context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(JSON.parse(response.body).user).sort(), ['firstName', 'id', 'username']);
});
