import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, api, required, waitOperation } from './lib/cloud.mjs';
import { yc, outputs, run } from './lib/process.mjs';

const deployment = outputs();
const secretId = deployment.secret_id;
let versionId = process.env.BOT_SECRET_VERSION_ID;
const key = process.env.BOT_SECRET_KEY || 'BOT_TOKEN';
if (!versionId) {
  const secret = await api(`https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secretId}`);
  versionId = secret.currentVersion?.id;
  if (!versionId) {
    const operation = await api(`https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secretId}:addVersion`, 'POST', {
      payloadEntries: [{ key, textValue: required('BOT_TOKEN') }],
    });
    const version = await waitOperation(operation);
    versionId = version.id;
  }
}
// Fail before deployment if .env token and Lockbox payload refer to different bots.
const payload = await api(`https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secretId}/payload?versionId=${versionId}`);
if (payload.entries?.find((entry) => entry.key === key)?.textValue !== required('BOT_TOKEN')) {
  throw new Error('BOT_TOKEN in .env differs from the selected Lockbox version');
}

run(process.execPath, ['scripts/migrate.mjs']);

const secretFlag = `id=${secretId},version-id=${versionId},key=${key},environment-variable=BOT_TOKEN`;
for (const name of ['api', 'bot']) {
  const environment = name === 'api'
    ? {
        YDB_CS: deployment.ydb_cs,
        ...(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS
          ? { TELEGRAM_AUTH_MAX_AGE_SECONDS: process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS } : {}),
        ...(process.env.TELEGRAM_AUTH_FUTURE_SKEW_SECONDS
          ? { TELEGRAM_AUTH_FUTURE_SKEW_SECONDS: process.env.TELEGRAM_AUTH_FUTURE_SKEW_SECONDS } : {}),
      }
    : { TG_PROXY_BASE: required('TG_PROXY_BASE'), TMA_URL: deployment.tma_url };
  const result = JSON.parse(yc([
    'serverless', 'function', 'version', 'create',
    '--function-id', deployment[`${name}_function_id`],
    '--runtime', 'nodejs22', '--entrypoint', 'index.handler',
    '--memory', name === 'api' ? '512MB' : '128MB',
    '--execution-timeout', name === 'api' ? '30s' : '15s',
    '--service-account-id', deployment[`${name}_runtime_sa_id`],
    '--source-path', `${root}/build/${name}.zip`,
    '--secret', secretFlag,
    '--environment', Object.entries(environment).map(([k, v]) => `${k}=${v}`).join(','),
  ], true));
  console.log(`${name}: deployed version ${result.id}`);
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const webRoot = `${root}/apps/web/dist`;
// Assets first, HTML last, retaining previous hashes for already-open clients.
const paths = files(webRoot).sort((a, b) => Number(a.endsWith('index.html')) - Number(b.endsWith('index.html')));
for (const path of paths) {
  const object = relative(webRoot, path).split('\\').join('/');
  const ext = object.slice(object.lastIndexOf('.'));
  yc(['storage', 's3', 'cp', path, `s3://${deployment.bucket}/${object}`,
    '--content-type', mime[ext] || 'application/octet-stream',
    '--cache-control', object === 'index.html' ? 'no-cache' : 'public,max-age=31536000,immutable',
    '--only-show-errors']);
}
console.log(`TMA deployed: ${deployment.tma_url}`);
