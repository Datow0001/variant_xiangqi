import test from 'node:test';
import assert from 'node:assert/strict';
import { previewIdentity, previewRecord, releasePlan } from '../rollout.mjs';
const commit = 'e031e19'.padEnd(40, 'a'), build = 'eb6cc12a-f77d-4ee8-95ea-4cf65cc2ea71';
const { tag, revision } = previewIdentity(commit, build);
const before = { status: { traffic: [{ revisionName: 'variant-xiangqi-00004-69k', percent: 100, latestRevision: true }] } };
const route = { revisionName: revision, tag, url: `https://${tag}---variant-xiangqi-qrsxycdmxa-de.a.run.app` };
test('preview accepts LATEST being pinned but requires zero traffic and the exact unique revision', () => {
  const after = { status: { traffic: [{ ...before.status.traffic[0], latestRevision: false }, route] } };
  assert.equal(previewRecord(before, after, commit, build).revision, revision);
  assert.throws(() => previewRecord(before, { status: { traffic: [{ ...route, percent: 100 }] } }, commit, build), /production traffic/);
  assert.throws(() => previewRecord(before, { status: { traffic: [before.status.traffic[0], { ...route, revisionName: 'wrong' }] } }, commit, build));
  assert.throws(() => previewRecord(before, { status: { traffic: [before.status.traffic[0]] } }, commit, build));
});
test('release and rollback always name an explicit service revision and reject shell/flag injection', () => {
  for (const mode of ['publish', 'rollback']) {
    const args = releasePlan(mode, revision);
    assert.ok(args.includes(`--to-revisions=${revision}=100`)); assert.ok(!args.includes('--to-latest'));
  }
  for (const invalid of ['LATEST', 'other-service-v1', 'variant-xiangqi-foo;echo', '--quiet', 'variant-xiangqi-foo$(whoami)']) assert.throws(() => releasePlan('publish', invalid));
  assert.throws(() => previewIdentity('', build)); assert.throws(() => releasePlan('deploy', revision));
});
