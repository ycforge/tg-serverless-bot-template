import { mkdirSync, writeFileSync } from 'node:fs';
import { api, required, waitOperation, root } from './lib/cloud.mjs';
import { outputs } from './lib/process.mjs';

const base = 'https://serverless-triggers.api.cloud.yandex.net/triggers/v2/triggers';
const deployment = outputs();
const name = required('TELEGRAM_TRIGGER_NAME');
const folderId = required('YC_FOLDER_ID');
let pageToken = '';
let existing;
do {
  const list = await api(`${base}?folderId=${folderId}&pageSize=100&pageToken=${encodeURIComponent(pageToken)}`);
  existing = list.triggers?.find((trigger) => trigger.name === name);
  pageToken = list.nextPageToken || '';
} while (!existing && pageToken);

const action = [{
  invokeFunction: {
    functionId: deployment.bot_function_id, functionTag: '$latest', serviceAccountId: deployment.invoker_sa_id,
  },
  retryPolicy: { retryAttempts: '3', interval: '10s' },
}];

if (existing) {
  if (!existing.source?.telegramMessage) throw new Error('Existing trigger is not a Telegram trigger');
  if (JSON.stringify(existing.action) === JSON.stringify(action)) {
    console.log(`Telegram trigger ${existing.id}: already configured; no changes.`);
  } else {
    mkdirSync(`${root}/.local`, { recursive: true, mode: 0o700 });
    writeFileSync(`${root}/.local/trigger-before.json`, JSON.stringify(existing, null, 2), { mode: 0o600 });
    await waitOperation(await api(`${base}/${existing.id}`, 'PATCH', { updateMask: 'action', action }));
    console.log(`Telegram trigger ${existing.id}: target updated, source and registration preserved.`);
  }
} else {
  await waitOperation(await api(base, 'POST', {
    folderId, name,
    source: { telegramMessage: { botToken: required('BOT_TOKEN'), allowedUpdates: ['message'], force: false } },
    action,
  }));
  console.log(`Telegram trigger ${name}: created.`);
}
