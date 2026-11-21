import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrivateKey, sign, constants } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
export function required(name) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
  return process.env[name];
}
let tokenPromise;
export function iamToken() {
  return tokenPromise ??= (async () => {
    const key = JSON.parse(readFileSync(required('YC_SERVICE_ACCOUNT_KEY_FILE'), 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${encode({ alg: 'PS256', kid: key.id })}.${encode({
      iss: key.service_account_id,
      aud: 'https://iam.api.cloud.yandex.net/iam/v1/tokens', iat: now, exp: now + 600,
    })}`;
    const signature = sign('sha256', Buffer.from(unsigned), {
      key: createPrivateKey(key.private_key), padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString('base64url');
    const response = await fetch('https://iam.api.cloud.yandex.net/iam/v1/tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`IAM authentication failed (${response.status})`);
    return (await response.json()).iamToken;
  })();
}

export async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${await iamToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    // Deliberately do not echo request/response bodies containing credentials.
    throw new Error(`Cloud API ${method} ${new URL(url).pathname}: HTTP ${response.status}`);
  }
  return data;
}

export async function waitOperation(operation, service = 'operation') {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!operation.done) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for operation ${operation.id}`);
    await new Promise((r) => setTimeout(r, 1500));
    operation = await api(`https://${service}.api.cloud.yandex.net/operations/${operation.id}`);
  }
  if (operation.error) throw new Error(`Cloud operation failed: ${operation.error.code}`);
  return operation.response;
}
