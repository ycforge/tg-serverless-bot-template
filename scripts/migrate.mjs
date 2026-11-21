import { readFileSync } from 'node:fs';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { iamToken, root } from './lib/cloud.mjs';
import { outputs } from './lib/process.mjs';

const deployment = outputs();
const driver = new Driver(deployment.ydb_cs, {
  credentialsProvider: new AccessTokenCredentialsProvider({ token: await iamToken() }),
});
let sql;
try {
  await driver.ready();
  sql = query(driver);
  // Execute only checked-in migration text; never interpolate user input here.
  for (const statement of readFileSync(`${root}/db/001-counters.sql`, 'utf8').split(';').filter((s) => s.trim())) {
    await sql`${sql.unsafe(statement)}`;
  }
  console.log('YDB schema is ready.');
} finally {
  try { if (sql) await sql[Symbol.asyncDispose](); }
  finally { driver.close(); }
}
