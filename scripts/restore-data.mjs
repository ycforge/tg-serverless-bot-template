import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { iamToken } from './lib/cloud.mjs';
import { outputs } from './lib/process.mjs';

const backup = process.argv[2];
if (!backup) throw new Error('Pass backup directory');
const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json')));
assert.equal(manifest.complete, true);
const deployment = outputs();
assert.equal(manifest.folderId, deployment.folder_id);
const driver = new Driver(deployment.ydb_cs, { credentialsProvider: new AccessTokenCredentialsProvider({ token: await iamToken() }) });
let sql, restoredRows = 0;
const revive = (_, value) => value && typeof value === 'object' && Object.keys(value).length === 1 && '__bigint' in value ? BigInt(value.__bigint) : value;
const normalize = (rows) => rows.map((row) => JSON.stringify(row, (_, v) => typeof v === 'bigint' ? String(v) : v)).sort();
try {
  await driver.ready();
  sql = query(driver);
  for (const oldDb of readdirSync(join(backup, 'databases'))) {
    for (const file of readdirSync(join(backup, 'databases', oldDb))) {
      const path = join('databases', oldDb, file);
      const bytes = readFileSync(join(backup, path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.hashes[path]);
      const saved = JSON.parse(bytes.toString(), revive);
      const table = saved.path.split('/').at(-1);
      if (!['tg_example_counters', 'tg_example_operations'].includes(table)) throw new Error(`Unsupported restore table: ${table}`);
      for (const row of saved.rows) {
        if (table === 'tg_example_counters') {
          await sql`UPSERT INTO tg_example_counters (user_id, value) VALUES (${row.user_id}, ${row.value})`;
        } else {
          await sql`UPSERT INTO tg_example_operations (user_id, operation_id, delta) VALUES (${row.user_id}, ${row.operation_id}, ${row.delta})`;
        }
        restoredRows++;
      }
      const [actual] = await sql`SELECT * FROM ${sql.identifier(table)}`;
      assert.deepEqual(normalize(actual), normalize(saved.rows), `Readback mismatch for ${table}`);
    }
  }
  console.log(`Restored and readback-verified ${restoredRows} rows in the new YDB database.`);
} finally {
  try { if (sql) await sql[Symbol.asyncDispose](); } finally { driver.close(); }
}
