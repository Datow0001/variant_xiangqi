import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { deployment, releasePlan, trafficMap } from './rollout.mjs';

const args = process.argv.slice(2), mode = args[0];
const option = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const revision = option('--revision'), commit = option('--commit');
const command = releasePlan(mode, revision);
if (mode === 'publish') assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Publish requires --commit FULL_SHA');
console.log(`Target: ${deployment.project}/${deployment.region}/${deployment.service}, ${mode} ${revision}`);
console.log(`gcloud ${command.join(' ')}`);
if (!args.includes('--execute')) {
  console.log('Dry run only. --execute changes production traffic after readiness/version checks.');
} else {
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  function run(arguments_) {
    // Windows cmd requires quoting. Every argument comes from a validated fixed
    // service/revision/commit or our own constants; no shell text is accepted.
    const result = spawnSync(gcloud, arguments_, { encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'gcloud failed');
    return result.stdout;
  }
  const scope = [`--project=${deployment.project}`, `--region=${deployment.region}`];
  const describeService = () => JSON.parse(run(['run', 'services', 'describe', deployment.service, ...scope, '--format=json']));
  const target = JSON.parse(run(['run', 'revisions', 'describe', revision, ...scope, '--format=json']));
  assert.ok(target.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Target revision is not ready');
  const before = describeService();
  const previousTraffic = trafficMap(before);
  if (mode === 'publish') {
    assert.equal(target.metadata?.labels?.['commit-sha'], commit, 'Revision commit does not match requested release');
    const preview = before.status?.traffic?.find(route => route.revisionName === revision && route.tag && route.url);
    assert.ok(preview, 'Publish requires a tagged preview URL');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const smoke = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(root, 'backend/node_modules/tsx/dist/loader.mjs')).href,
      path.join(root, 'backend/src/deployment-smoke.ts'), '--url', preview.url, '--expect-version', commit], { stdio: 'inherit', timeout: 180000 });
    if (smoke.error) throw smoke.error;
    assert.equal(smoke.status, 0, 'Target failed smoke checks');
  }
  assert.deepEqual(trafficMap(describeService()), previousTraffic, 'Production traffic changed during acceptance; review again');
  mkdirSync('.deployment', { recursive: true });
  const recordPath = `.deployment/${mode}-${Date.now()}.json`;
  writeFileSync(recordPath, JSON.stringify({ mode, revision, commit, previousTraffic, imageDigest: target.status?.imageDigest, startedAt: new Date().toISOString() }, null, 2));
  run(command);
  assert.deepEqual(trafficMap(describeService()), { [revision]: 100 }, 'Traffic update was not confirmed');
  console.log(`Traffic confirmed. Previous allocation saved to ${recordPath}`);
}
