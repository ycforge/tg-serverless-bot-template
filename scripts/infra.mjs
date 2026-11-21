import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { root, required } from './lib/cloud.mjs';
import { run } from './lib/process.mjs';

const action = process.argv[2];
if (!['plan', 'apply', 'destroy', 'migrate'].includes(action)) {
  throw new Error('Use plan, apply, destroy or migrate');
}
mkdirSync(`${root}/.local`, { recursive: true, mode: 0o700 });

function backendIsS3() {
  const path = `${root}/infra/.terraform/terraform.tfstate`;
  if (!existsSync(path)) return false;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).backend?.type === 's3';
  } catch {
    return false;
  }
}
if (action !== 'migrate' && existsSync(`${root}/infra/terraform.tfstate`) && !backendIsS3()) {
  throw new Error('Local Terraform state found. Run `npm run infra:state:migrate` before plan/apply.');
}
for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`Missing ${name} for the S3 Terraform backend`);
}

function hcl(value) {
  return JSON.stringify(value);
}

const backendPath = `${root}/.local/backend.hcl`;
const backend = [
  `bucket = ${hcl(required('TF_STATE_BUCKET'))}`,
  `key = ${hcl(process.env.TF_STATE_KEY || `${process.env.PROJECT_NAME || 'tg-serverless-example'}/terraform.tfstate`)}`,
  `region = ${hcl(process.env.TF_STATE_REGION || 'ru-central1')}`,
  'endpoints = {',
  `  s3 = ${hcl(process.env.TF_STATE_ENDPOINT || 'https://storage.yandexcloud.net')}`,
  '}',
  'use_lockfile = true',
  'skip_region_validation = true',
  'skip_credentials_validation = true',
  'skip_requesting_account_id = true',
  'skip_s3_checksum = true',
].join('\n') + '\n';
writeFileSync(backendPath, backend, { mode: 0o600 });

const env = {
  ...process.env,
  YC_TERRAFORM_INITIALIZATION_SILENCE: 'true',
  TF_IN_AUTOMATION: 'true',
  TF_VAR_folder_id: required('YC_FOLDER_ID'),
  TF_VAR_service_account_key_file: required('YC_SERVICE_ACCOUNT_KEY_FILE'),
  TF_VAR_name: process.env.PROJECT_NAME || 'tg-serverless-example',
  TF_VAR_existing_ydb_id: process.env.EXISTING_YDB_ID || '',
  TF_VAR_bot_secret_id: process.env.BOT_SECRET_ID || '',
};
// BOT_TOKEN is never passed as a Terraform variable or stored in its state.
delete env.BOT_TOKEN;

const init = ['-chdir=infra', 'init', `-backend-config=${backendPath}`];
if (action === 'migrate') {
  run('terraform', [...init, '-migrate-state'], { env });
  console.log('Terraform state migrated to the configured S3 backend.');
  process.exit(0);
}
run('terraform', [...init, '-input=false'], { env });
run('terraform', ['-chdir=infra', 'fmt', '-check'], { env });
run('terraform', ['-chdir=infra', 'validate'], { env });
run('terraform', [
  '-chdir=infra', 'plan', '-input=false', '-lock-timeout=5m',
  ...(action === 'destroy' ? ['-destroy'] : []),
  '-out=../.local/infra.tfplan',
], { env });
if (action !== 'plan') {
  run('terraform', ['-chdir=infra', 'apply', '-input=false', '-lock-timeout=5m', '../.local/infra.tfplan'], { env });
}
