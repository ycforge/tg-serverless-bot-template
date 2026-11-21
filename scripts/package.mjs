import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib/cloud.mjs';
import { run } from './lib/process.mjs';

const stage = resolve(root, '.local/package');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(resolve(root, 'build'), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) cpSync(resolve(root, file), resolve(stage, file));
for (const app of ['api', 'bot', 'web']) {
  mkdirSync(resolve(stage, 'apps', app), { recursive: true });
  cpSync(resolve(root, 'apps', app, 'package.json'), resolve(stage, 'apps', app, 'package.json'));
}
cpSync(resolve(root, 'apps/api/dist'), resolve(stage, 'apps/api/dist'), { recursive: true });
writeFileSync(resolve(stage, 'index.js'), "module.exports = require('./apps/api/dist/index.js');\n");
// Ship source plus the checked-in lockfile. The YC Node.js builder installs
// dependencies; embedding node_modules exceeds its 3.5 MB inline limit.
for (const name of ['api', 'bot']) rmSync(resolve(root, `build/${name}.zip`), { force: true });
run('zip', ['-qr', resolve(root, 'build/api.zip'), '.'], { cwd: stage });
run('zip', ['-qr', resolve(root, 'build/bot.zip'), '.'], { cwd: resolve(root, 'apps/bot/dist') });
console.log('Packaged build/api.zip and build/bot.zip (no .env or credentials).');
