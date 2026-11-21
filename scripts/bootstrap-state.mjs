import { mkdirSync } from 'node:fs';
import { root, required } from './lib/cloud.mjs';
import { run } from './lib/process.mjs';

const action = process.argv[2] || 'plan';
if (!['plan', 'apply'].includes(action)) throw new Error('Use plan or apply');
mkdirSync(`${root}/.local`, { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  YC_TERRAFORM_INITIALIZATION_SILENCE: 'true',
  TF_IN_AUTOMATION: 'true',
  TF_VAR_folder_id: required('YC_FOLDER_ID'),
  TF_VAR_service_account_key_file: required('YC_SERVICE_ACCOUNT_KEY_FILE'),
  TF_VAR_state_bucket: required('TF_STATE_BUCKET'),
};
delete env.BOT_TOKEN;
run('terraform', ['-chdir=infra/bootstrap', 'init', '-input=false'], { env });
run('terraform', ['-chdir=infra/bootstrap', 'fmt', '-check'], { env });
run('terraform', ['-chdir=infra/bootstrap', 'validate'], { env });
run('terraform', [
  '-chdir=infra/bootstrap', 'plan', '-input=false', '-lock-timeout=5m',
  '-out=../../.local/state-bootstrap.tfplan',
], { env });
if (action === 'apply') {
  run('terraform', [
    '-chdir=infra/bootstrap', 'apply', '-input=false', '-lock-timeout=5m',
    '../../.local/state-bootstrap.tfplan',
  ], { env });
}
