import { mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { api, root, required, iamToken } from './lib/cloud.mjs';
import { yc, outputs, run } from './lib/process.mjs';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { SchemeServiceDefinition, ListDirectoryResultSchema, Entry_Type } from '@ydbjs/api/scheme';
import { TableServiceDefinition, CreateSessionResultSchema, DescribeTableResultSchema } from '@ydbjs/api/table';
import { anyUnpack } from '@bufbuild/protobuf/wkt';
import { toJson } from '@bufbuild/protobuf';

const destination = resolve(process.argv[2] || '');
if (!process.argv[2] || destination.startsWith(resolve(root))) throw new Error('Choose a backup directory outside the repository');
process.umask(0o077);
mkdirSync(destination, { recursive: true, mode: 0o700 });
chmodSync(destination, 0o700);
const folderId = required('YC_FOLDER_ID');
function save(name, data) {
  const path = join(destination, name);
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? { __bigint: String(v) } : v, 2), { mode: 0o600 });
}
async function list(base, field, parameters = { folderId }) {
  let pageToken = '', items = [];
  do {
    const response = await api(`${base}?${new URLSearchParams({ ...parameters, pageToken })}`);
    items.push(...response[field] || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return items;
}
const definitions = {
  functions: ['https://serverless-functions.api.cloud.yandex.net/functions/v1/functions', 'functions'],
  gateways: ['https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways', 'apiGateways'],
  triggers: ['https://serverless-triggers.api.cloud.yandex.net/triggers/v2/triggers', 'triggers'],
  databases: ['https://ydb.api.cloud.yandex.net/ydb/v1/databases', 'databases'],
  secrets: ['https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets', 'secrets'],
  kms: ['https://kms.api.cloud.yandex.net/kms/v1/keys', 'keys'],
  accounts: ['https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts', 'serviceAccounts'],
  instances: ['https://compute.api.cloud.yandex.net/compute/v1/instances', 'instances'],
  networks: ['https://vpc.api.cloud.yandex.net/vpc/v1/networks', 'networks'],
};
const resources = {};
for (const [kind, [base, field]] of Object.entries(definitions)) resources[kind] = await list(base, field);
resources.buckets = JSON.parse(yc(['storage', 'bucket', 'list'], true));
const deployerId = JSON.parse(readFileSync(required('YC_SERVICE_ACCOUNT_KEY_FILE'), 'utf8')).service_account_id;
const inventory = {
  folderId,
  deployerId,
  createdAt: new Date().toISOString(),
  resources,
  logging: {
    excluded: true,
    reason: 'Cloud Logging is deliberately not used by this template; application logs are stdout only.',
  },
};
save('inventory.json', inventory);
save('deployment.json', outputs());
save('folder-iam.json', await api(`https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}:listAccessBindings`));
cpSync(join(root, '.env'), join(destination, 'original.env'));
cpSync(join(root, 'infra/terraform.tfstate'), join(destination, 'terraform.tfstate'));
run('git', ['archive', '--format=tar', '-o', join(destination, 'source-before-reset.tar'), 'HEAD']);

let payloadCount = 0;
for (const secret of resources.secrets) {
  const base = `https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secret.id}`;
  save(`secrets/${secret.id}/metadata.json`, await api(base));
  save(`secrets/${secret.id}/iam.json`, await api(`${base}:listAccessBindings`));
  const versions = await list(`${base}/versions`, 'versions', {});
  save(`secrets/${secret.id}/versions.json`, versions);
  for (const version of versions) {
    if (version.status === 'DESTROYED') continue;
    const payload = await api(`https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secret.id}/payload?versionId=${version.id}`);
    if (!Array.isArray(payload.entries)) throw new Error('Invalid secret payload backup');
    save(`secrets/${secret.id}/payload-${version.id}.json`, payload);
    payloadCount++;
  }
}
for (const fn of resources.functions) {
  save(`functions/${fn.id}.json`, { function: fn,
    versions: await list('https://serverless-functions.api.cloud.yandex.net/functions/v1/versions', 'versions', { functionId: fn.id }),
    iam: await api(`https://serverless-functions.api.cloud.yandex.net/functions/v1/functions/${fn.id}:listAccessBindings`),
  });
}
for (const gateway of resources.gateways) {
  save(`gateways/${gateway.id}.json`, await api(`https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${gateway.id}`));
}
for (const key of resources.kms) {
  save(`kms/${key.id}.json`, { metadata: key, iam: await api(`https://kms.api.cloud.yandex.net/kms/v1/keys/${key.id}:listAccessBindings`) });
}
for (const bucket of resources.buckets) {
  const name = bucket.name;
  save(`buckets/${name}/metadata.json`, bucket);
  const objects = JSON.parse(yc(['storage', 's3api', 'list-objects', '--bucket', name], true));
  if (objects.IsTruncated || objects.isTruncated) throw new Error('Bucket pagination needs explicit handling before reset');
  save(`buckets/${name}/objects.json`, objects);
  for (const item of objects.Contents || objects.contents || []) {
    const key = item.Key || item.key;
    const output = join(destination, 'buckets', name, 'objects', Buffer.from(key).toString('base64url'));
    mkdirSync(resolve(output, '..'), { recursive: true });
    const metadata = JSON.parse(yc(['storage', 's3api', 'get-object', '--bucket', name, '--key', key, output], true));
    save(`buckets/${name}/headers/${Buffer.from(key).toString('base64url')}.json`, metadata);
  }
}

let tableCount = 0, rowCount = 0;
for (const database of resources.databases) {
  const driver = new Driver(database.endpoint, { credentialsProvider: new AccessTokenCredentialsProvider({ token: await iamToken() }) });
  let sql, sessionId;
  try {
    await driver.ready();
    sql = query(driver);
    const scheme = driver.createClient(SchemeServiceDefinition);
    const table = driver.createClient(TableServiceDefinition);
    const unpack = (response, schema) => {
      if (response.operation?.status !== 400000) throw new Error(`YDB backup operation failed (${response.operation?.status})`);
      return anyUnpack(response.operation.result, schema);
    };
    sessionId = unpack(await table.createSession({}), CreateSessionResultSchema).sessionId;
    async function visit(path) {
      const entries = unpack(await scheme.listDirectory({ path }), ListDirectoryResultSchema);
      for (const entry of entries.children) {
        if (entry.name.startsWith('.')) continue;
        const child = `${path}/${entry.name}`;
        if (entry.type === Entry_Type.DIRECTORY) await visit(child);
        else if (entry.type === Entry_Type.TABLE) {
          const schema = unpack(await table.describeTable({ sessionId, path: child }), DescribeTableResultSchema);
          const [rows] = await sql`SELECT * FROM ${sql.identifier(child)}`.isolation('snapshotReadOnly');
          save(`databases/${database.id}/${Buffer.from(child).toString('base64url')}.json`, { path: child, schema: toJson(DescribeTableResultSchema, schema), rows });
          tableCount++; rowCount += rows.length;
        } else throw new Error(`Unsupported application YDB object ${child}: type ${entry.type}`);
      }
    }
    await visit(driver.database);
  } finally {
    try { if (sql) await sql[Symbol.asyncDispose](); }
    finally { if (sessionId) await driver.createClient(TableServiceDefinition).deleteSession({ sessionId }); driver.close(); }
  }
}
function files(dir) { return readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]); }
for (const path of files(destination)) chmodSync(path, 0o600);
const hashes = Object.fromEntries(files(destination).filter((p) => !p.endsWith('/manifest.json')).map((path) => [relative(destination, path), createHash('sha256').update(readFileSync(path)).digest('hex')]));
for (const [path, hash] of Object.entries(hashes)) if (createHash('sha256').update(readFileSync(join(destination, path))).digest('hex') !== hash) throw new Error('Backup readback failed');
save('manifest.json', { folderId, deployerId, complete: true, payloadCount, tableCount, rowCount, hashes });
console.log(JSON.stringify({ backup: destination, payloadCount, tableCount, rowCount, files: Object.keys(hashes).length, loggingExcluded: true }));
