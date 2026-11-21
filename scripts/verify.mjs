import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { required, iamToken, api as cloudApi } from './lib/cloud.mjs';
import { outputs } from './lib/process.mjs';

const deployment = outputs();
const base = deployment.tma_url.replace(/\/$/, '');
const ids = ['4000000000000001', '4000000000000002'];
function authorization(id) {
  // Synthetic signed data for infrastructure tests, not a real Telegram launch.
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(id), first_name: 'Smoke test' }) });
  const text = [...p.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(required('BOT_TOKEN')).digest();
  p.set('hash', createHmac('sha256', key).update(text).digest('hex'));
  return `tma ${p}`;
}
async function request(path, id, body) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(id ? { Authorization: authorization(id) } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, `API ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const driver = new Driver(deployment.ydb_cs, { credentialsProvider: new AccessTokenCredentialsProvider({ token: await iamToken() }) });
await driver.ready();
const sql = query(driver);
async function cleanup() {
  for (const id of ids) {
    await sql`DELETE FROM tg_example_operations WHERE user_id = ${id}`;
    await sql`DELETE FROM tg_example_counters WHERE user_id = ${id}`;
  }
}
try {
  for (const name of ['bot', 'api']) {
    const versions = await cloudApi(`https://serverless-functions.api.cloud.yandex.net/functions/v1/versions?functionId=${deployment[`${name}_function_id`]}`);
    const latest = versions.versions?.find((version) => version.tags?.includes('$latest'));
    assert.equal(latest?.runtime, 'nodejs22');
    assert.equal(latest?.serviceAccountId, deployment[`${name}_runtime_sa_id`]);
    assert.ok(!Object.hasOwn(latest?.environment || {}, 'BOT_TOKEN'));
    assert.ok(latest?.secrets?.some((secret) => secret.id === deployment.secret_id && secret.environmentVariable === 'BOT_TOKEN'));
  }
  console.log('PASS: both functions run Node.js 22 under runtime identities; BOT_TOKEN is injected from Lockbox.');
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="root"/);
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)) {
    assert.equal((await fetch(base + asset[1])).status, 200);
  }
  await request('health');
  assert.equal((await fetch(`${base}/api/counter`)).status, 401);
  assert.ok([401, 403].includes((await fetch(`https://functions.yandexcloud.net/${deployment.api_function_id}`)).status));
  assert.ok([401, 403].includes((await fetch(`https://storage.yandexcloud.net/${deployment.bucket}/index.html`)).status));
  console.log('PASS: gateway serves HTML/assets; direct function and S3 access is private; API requires Telegram auth.');
  await cleanup();
  assert.equal((await request('auth/telegram', ids[0], {})).user.id, ids[0]);
  assert.equal((await request('counter', ids[0])).value, '0');
  const operation = { operationId: randomUUID(), delta: 1 };
  assert.equal((await request('counter/change', ids[0], operation)).value, '1');
  assert.equal((await request('counter/change', ids[0], operation)).value, '1');
  assert.equal((await request('counter', ids[1])).value, '0');
  await Promise.all(Array.from({ length: 3 }, () => request('counter/change', ids[0], { operationId: randomUUID(), delta: 1 })));
  assert.equal((await request('counter', ids[0])).value, '4');
  assert.equal((await request('counter/change', ids[0], { operationId: randomUUID(), delta: -1 })).value, '3');
  console.log('PASS: signed login, YDB persistence, user isolation, idempotency, concurrent increments and decrement.');
} finally {
  try { await cleanup(); } finally {
    try { await sql[Symbol.asyncDispose](); } finally { driver.close(); }
  }
}
console.log(`Verified ${deployment.tma_url}. Synthetic test records removed.`);
