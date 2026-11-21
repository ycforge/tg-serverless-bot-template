import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { root, required } from './lib/cloud.mjs';

const backup = process.argv[2];
if (!backup) throw new Error('Pass frozen backup directory');
const baseline = JSON.parse(readFileSync(join(backup, 'zero-baseline.json')));
assert.equal(baseline.folderId, required('YC_FOLDER_ID'));
for (const [kind, count] of Object.entries(baseline.counts)) {
  const expected = kind === 'accounts' ? (baseline.preservedAccountIds?.length ?? 1)
    : kind === 'buckets' && baseline.preservedStateBucket ? 1 : 0;
  assert.equal(count, expected);
}
const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json')));
const old = parseEnv(readFileSync(join(backup, 'original.env'), 'utf8'));
const deployment = JSON.parse(readFileSync(join(backup, 'deployment.json')));
const secret = JSON.parse(readFileSync(join(backup, 'secrets', deployment.secret_id, 'metadata.json')));
const version = old.BOT_SECRET_VERSION_ID || secret.currentVersion.id;
const payloadPath = `secrets/${deployment.secret_id}/payload-${version}.json`;
const bytes = readFileSync(join(backup, payloadPath));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.hashes[payloadPath]);
const key = old.BOT_SECRET_KEY || 'BOT_TOKEN';
const token = JSON.parse(bytes.toString()).entries.find((entry) => entry.key === key)?.textValue;
if (!token) throw new Error('Bot token is missing in verified backup');
const current = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
Object.assign(current, { BOT_TOKEN: token, BOT_SECRET_ID: '', BOT_SECRET_VERSION_ID: '', EXISTING_YDB_ID: '' });
writeFileSync(join(root, '.env'), Object.entries(current).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log('Restored BOT_TOKEN from verified backup; old YDB and Lockbox references cleared.');
