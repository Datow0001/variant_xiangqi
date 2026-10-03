import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { previewRecord } from './rollout.mjs';
const [commit, build, service] = process.argv.slice(2);
const before = JSON.parse(await readFile('.deployment/before.json', 'utf8'));
const after = JSON.parse(await readFile('.deployment/after.json', 'utf8'));
const record = previewRecord(before, after, commit, build, service);
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(root, 'backend/node_modules/tsx/dist/loader.mjs')).href,
  path.join(root, 'backend/src/deployment-smoke.ts'), '--url', record.url, '--expect-version', commit], { stdio: 'inherit', timeout: 180000 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Preview smoke failed; do not publish this revision');
await writeFile('.deployment/preview.json', JSON.stringify({ ...record, automatedChecks: 'passed', checkedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify(record, null, 2));
console.log('Automated checks passed. Mobile/player acceptance is still required before publication.');
