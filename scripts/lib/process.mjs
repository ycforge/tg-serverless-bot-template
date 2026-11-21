import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, required } from './cloud.mjs';
process.env.YC_CLI_INITIALIZATION_SILENCE = 'true';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    let detail = result.stderr?.toString().slice(-4000) || '';
    if (process.env.BOT_TOKEN) detail = detail.replaceAll(process.env.BOT_TOKEN, '[REDACTED]');
    throw new Error(`${command} failed (${result.status ?? result.error?.code})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

let config;
function ycConfig() {
  if (!config) {
    const dir = mkdtempSync(join(tmpdir(), 'telegram-yc-'));
    config = join(dir, 'config.yaml');
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    run('yc', ['--config', config, 'config', 'set', 'service-account-key', required('YC_SERVICE_ACCOUNT_KEY_FILE')], { stdio: 'pipe' });
  }
  return config;
}
export function yc(args, json = false) {
  return run('yc', ['--config', ycConfig(), '--folder-id', required('YC_FOLDER_ID'), ...args,
    ...(json ? ['--format', 'json'] : [])], json ? { encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 } : {});
}

export function outputs() {
  const result = run('terraform', ['-chdir=infra', 'output', '-json', 'deployment'], {
    encoding: 'utf8', stdio: 'pipe', maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result);
}
