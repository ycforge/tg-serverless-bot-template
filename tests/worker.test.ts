import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Worker {
  fetch(request: Request): Promise<Response>;
}
const workerPromise: Promise<Worker> = import(new URL('../workers/telegram-proxy/worker.mjs', import.meta.url).href)
  .then((module) => module.default);
const token = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi';

function request(path: string, init: RequestInit = {}, ip = '192.0.2.1') {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', 'node-test-client');
  headers.set('CF-Connecting-IP', ip);
  return new Request(`https://proxy.example${path}`, { ...init, headers });
}

test('Worker serves its landing page and local stats without calling Telegram', async () => {
  const worker = await workerPromise;
  const page = await worker.fetch(request('/'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Telegram API Proxy/);
  const stats = await worker.fetch(request('/stats'));
  assert.equal((await stats.json()).ok, true);
  assert.equal((await worker.fetch(request('/unknown'))).status, 404);
  assert.equal((await worker.fetch(request('/anything', { method: 'OPTIONS' }))).status, 204);
});

test('Worker forwards POST sendMessage and strips unrelated client credentials', async (t) => {
  const worker = await workerPromise;
  const payload = { chat_id: 123, text: 'ping' };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    const upstream = input as Request;
    assert.equal(upstream.url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(upstream.method, 'POST');
    assert.deepEqual(await upstream.json(), payload);
    assert.equal(upstream.headers.get('Authorization'), null);
    assert.equal(upstream.headers.get('Cookie'), null);
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const response = await worker.fetch(request(`/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer unrelated', Cookie: 'session=unrelated' },
    body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.message_id, 1);
  assert.equal(calls, 1);
});

test('Worker preserves upstream query strings and file bytes', async (t) => {
  const worker = await workerPromise;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal((input as Request).url, `https://api.telegram.org/file/bot${token}/photos/example.jpg?download=1`);
    return new Response(new Uint8Array([0, 1, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const response = await worker.fetch(request(`/file/bot${token}/photos/example.jpg?download=1`, {}, '192.0.2.2'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 255]));
});

test('Worker rejects malformed tokens before making an upstream request', async (t) => {
  const worker = await workerPromise;
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected upstream call');
  });
  const response = await worker.fetch(request('/botinvalid-token/getMe', {}, '192.0.2.3'));
  assert.equal(response.status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Worker does not retry a POST after a network failure', async (t) => {
  const worker = await workerPromise;
  t.mock.method(console, 'error', () => undefined);
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Simulated connection failure');
  });
  const response = await worker.fetch(request(`/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }, '192.0.2.4'));
  assert.equal(response.status, 500);
  assert.equal(fetch.mock.callCount(), 1);
});
