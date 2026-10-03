import assert from 'node:assert/strict';
export const deployment = { project: 'gen-lang-client-0656791737', region: 'asia-east1', service: 'variant-xiangqi' };
export function previewIdentity(commit, build, service = deployment.service) {
  assert.match(commit, /^[a-f0-9]{40}$/); assert.match(build, /^[a-f0-9]{8}-[a-f0-9-]+$/);
  const tag = `preview-${commit.slice(0, 7)}-${build.slice(0, 8)}`;
  return { tag, revision: `${service}-${tag}` };
}
export function trafficMap(service) {
  const map = {};
  for (const route of service.status?.traffic ?? []) if (route.percent > 0) {
    assert.ok(route.revisionName, 'Traffic must resolve to a concrete revision');
    map[route.revisionName] = (map[route.revisionName] ?? 0) + route.percent;
  }
  assert.equal(Object.values(map).reduce((total, percent) => total + percent, 0), 100, 'Traffic must total 100%');
  return Object.fromEntries(Object.entries(map).sort());
}
export function previewRecord(before, after, commit, build, service = deployment.service) {
  const { tag, revision } = previewIdentity(commit, build, service);
  assert.deepEqual(trafficMap(after), trafficMap(before), 'Preview deployment changed production traffic');
  const route = after.status?.traffic?.find(route => route.tag === tag);
  assert.equal(route?.revisionName, revision); assert.equal(route.percent ?? 0, 0);
  assert.match(route.url ?? '', /^https:\/\/[a-z0-9-]+\.a\.run\.app$|^https:\/\/[a-z0-9.-]+\.run\.app$/);
  return { commit, build, revision, tag, url: route.url, previousTraffic: trafficMap(before) };
}
export function releasePlan(mode, revision) {
  assert.ok(['publish', 'rollback'].includes(mode), 'Choose publish or rollback');
  assert.ok(typeof revision === 'string' && revision.startsWith(`${deployment.service}-`), 'Revision must belong to this service');
  assert.match(revision, /^[a-z][a-z0-9-]{0,62}$/); assert.notEqual(revision, deployment.service);
  return ['run', 'services', 'update-traffic', deployment.service, `--project=${deployment.project}`, `--region=${deployment.region}`, `--to-revisions=${revision}=100`, '--quiet'];
}
