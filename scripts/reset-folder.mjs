import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { api, root, required, waitOperation } from './lib/cloud.mjs';
import { yc, run } from './lib/process.mjs';

// Intentionally not part of npm run deploy. Destruction requires a complete,
// readback-verified external backup and the explicit target folder ID.
const [phase, backup, confirmedFolder] = process.argv.slice(2);
if (!['freeze', 'destroy'].includes(phase) || !backup || !confirmedFolder) {
  throw new Error('Usage: reset-folder.mjs freeze|destroy BACKUP_DIR FOLDER_ID');
}
if (resolve(backup).startsWith(resolve(root))) throw new Error('Backup must be outside repository');
const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json')));
const inventory = JSON.parse(readFileSync(join(backup, 'inventory.json')));
const folderId = required('YC_FOLDER_ID');
const stateBucket = required('TF_STATE_BUCKET');
const stateAccount = phase === 'destroy' ? required('TF_STATE_SERVICE_ACCOUNT_ID') : undefined;
assert.equal(manifest.complete, true);
assert.equal(confirmedFolder, folderId);
assert.equal(inventory.folderId, folderId);
for (const [path, hash] of Object.entries(manifest.hashes)) {
  assert.equal(createHash('sha256').update(readFileSync(join(backup, path))).digest('hex'), hash, `Backup mismatch: ${path}`);
}
const deployer = JSON.parse(readFileSync(required('YC_SERVICE_ACCOUNT_KEY_FILE'))).service_account_id;
assert.equal(deployer, manifest.deployerId);
if (!inventory.resources.accounts.some((a) => a.id === deployer)) throw new Error('Deployer identity not in snapshot');
const preservedAccounts = new Set([deployer, stateAccount].filter(Boolean));
const preservedAccountIds = inventory.resources.accounts.filter((a) => preservedAccounts.has(a.id)).map((a) => a.id).sort();
async function remove(url) {
  try { await waitOperation(await api(url, 'DELETE')); }
  catch (error) { if (!error.message.endsWith('HTTP 404')) throw error; }
}
async function exists(url) {
  try { await api(url); return true; }
  catch (error) { if (error.message.endsWith('HTTP 404')) return false; throw error; }
}
if (phase === 'freeze') {
  for (const trigger of inventory.resources.triggers) {
    await remove(`https://serverless-triggers.api.cloud.yandex.net/triggers/v2/triggers/${trigger.id}`);
  }
  for (const gateway of inventory.resources.gateways) {
    await remove(`https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways/${gateway.id}`);
  }
  // The registration belongs to the deleted trigger; keep pending messages.
  const response = await fetch(`${required('TG_PROXY_BASE')}${required('BOT_TOKEN')}/deleteWebhook`, { method: 'POST', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !(await response.json()).ok) throw new Error('Could not clear old webhook registration');
  console.log('Ingress removed. Make a final frozen backup before destroy.');
} else {
  if (inventory.resources.gateways.length || inventory.resources.triggers.length) throw new Error('Use a frozen backup taken after ingress removal');
  if (inventory.resources.instances.length || inventory.resources.networks.length) throw new Error('Unsupported non-serverless resources in snapshot');
  for (const bucket of inventory.resources.buckets) {
    if (bucket.name === stateBucket) continue;
    if (bucket.versioning && bucket.versioning !== 'VERSIONING_DISABLED') throw new Error('Versioned bucket requires a dedicated backup/delete workflow');
    yc(['storage', 's3', 'rm', `s3://${bucket.name}/`, '--recursive', '--only-show-errors']);
  }
  // Backups were verified above. Unlock both Terraform-managed and legacy
  // protected resources so this workflow also works on subsequent clean resets.
  for (const database of inventory.resources.databases) yc(['ydb', 'database', 'update', database.id, '--no-deletion-protection'], true);
  for (const secret of inventory.resources.secrets) yc(['lockbox', 'secret', 'update', secret.id, '--no-deletion-protection'], true);
  for (const key of inventory.resources.kms) yc(['kms', 'symmetric-key', 'update', key.id, '--no-deletion-protection'], true);
  run(process.execPath, ['scripts/infra.mjs', 'destroy']);
  for (const fn of inventory.resources.functions) await remove(`https://serverless-functions.api.cloud.yandex.net/functions/v1/functions/${fn.id}`);
  for (const database of inventory.resources.databases) {
    if (!await exists(`https://ydb.api.cloud.yandex.net/ydb/v1/databases/${database.id}`)) continue;
    yc(['ydb', 'database', 'delete', database.id], true);
  }
  for (const secret of inventory.resources.secrets) {
    if (!await exists(`https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secret.id}`)) continue;
    yc(['lockbox', 'secret', 'delete', secret.id], true);
  }
  for (const key of inventory.resources.kms) {
    if (!await exists(`https://kms.api.cloud.yandex.net/kms/v1/keys/${key.id}`)) continue;
    yc(['kms', 'symmetric-key', 'delete', key.id], true);
  }
  const bindings = await api(`https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}:listAccessBindings`);
  const oldAccounts = new Set(inventory.resources.accounts.filter((a) => !preservedAccounts.has(a.id)).map((a) => a.id));
  const deltas = bindings.accessBindings.filter((b) => b.subject.type === 'serviceAccount' && oldAccounts.has(b.subject.id))
    .map((accessBinding) => ({ action: 'REMOVE', accessBinding }));
  if (deltas.length) await waitOperation(await api(`https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}:updateAccessBindings`, 'POST', { accessBindingDeltas: deltas }));
  for (const account of inventory.resources.accounts) {
    if (!preservedAccounts.has(account.id)) await remove(`https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts/${account.id}`);
  }
  // Verify the zero baseline rather than assuming deletion succeeded.
  const endpoints = {
    functions: ['https://serverless-functions.api.cloud.yandex.net/functions/v1/functions', 'functions'],
    gateways: ['https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways', 'apiGateways'],
    triggers: ['https://serverless-triggers.api.cloud.yandex.net/triggers/v2/triggers', 'triggers'],
    databases: ['https://ydb.api.cloud.yandex.net/ydb/v1/databases', 'databases'],
    secrets: ['https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets', 'secrets'],
    kms: ['https://kms.api.cloud.yandex.net/kms/v1/keys', 'keys'],
    accounts: ['https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts', 'serviceAccounts'],
  };
  const counts = {};
  for (const [kind, [url, field]] of Object.entries(endpoints)) {
    const response = await api(`${url}?folderId=${folderId}`);
    const items = response[field] || [];
    if (kind === 'accounts') assert.deepEqual(items.map((a) => a.id).sort(), preservedAccountIds);
    else assert.equal(items.length, 0, `Remaining ${kind}`);
    counts[kind] = items.length;
  }
  const remainingBuckets = JSON.parse(yc(['storage', 'bucket', 'list'], true));
  const preservedStateBucket = inventory.resources.buckets.some((bucket) => bucket.name === stateBucket) ? stateBucket : '';
  assert.deepEqual(remainingBuckets.map((bucket) => bucket.name).sort(), preservedStateBucket ? [stateBucket] : []);
  counts.buckets = remainingBuckets.length;
  writeFileSync(join(backup, 'zero-baseline.json'), JSON.stringify({ folderId, preservedDeployer: deployer, preservedAccountIds, preservedStateBucket, verifiedAt: new Date().toISOString(), counts, logging: { excluded: true, reason: 'Cloud Logging is deliberately not used; application logs are stdout only.' } }, null, 2), { mode: 0o600 });
  console.log('Zero baseline verified:', JSON.stringify(counts));
}
