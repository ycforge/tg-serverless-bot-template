import { mkdirSync } from 'node:fs';
import { root, required } from './lib/cloud.mjs';
import { run } from './lib/process.mjs';

const action = process.argv[2];
if (!['plan', 'apply', 'destroy'].includes(action)) throw new Error('Use plan, apply or destroy');
mkdirSync(`${root}/.local`, { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  YC_TERRAFORM_INITIALIZATION_SILENCE: 'true',
  TF_VAR_folder_id: required('YC_FOLDER_ID'),
  TF_VAR_service_account_key_file: required('YC_SERVICE_ACCOUNT_KEY_FILE'),
  TF_VAR_name: process.env.PROJECT_NAME || 'tg-serverless-example',
  TF_VAR_existing_ydb_id: process.env.EXISTING_YDB_ID || '',
  TF_VAR_bot_secret_id: process.env.BOT_SECRET_ID || '',
};
// BOT_TOKEN is never passed as a Terraform variable or stored in its state.
delete env.BOT_TOKEN;
run('terraform', ['-chdir=infra', 'init', '-input=false'], { env });
run('terraform', ['-chdir=infra', 'fmt', '-check'], { env });
run('terraform', ['-chdir=infra', 'validate'], { env });
run('terraform', ['-chdir=infra', 'plan', '-input=false', ...(action === 'destroy' ? ['-destroy'] : []), '-out=../.local/infra.tfplan'], { env });
if (action !== 'plan') run('terraform', ['-chdir=infra', 'apply', '-input=false', '../.local/infra.tfplan'], { env });
