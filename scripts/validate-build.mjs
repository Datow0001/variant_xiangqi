import assert from 'node:assert/strict';
const [project, expectedProject, commit, build] = process.argv.slice(2);
assert.equal(project, expectedProject, 'Build project differs from deployment project');
assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'A full Git commit is required');
assert.match(build ?? '', /^[a-f0-9]{8}-[a-f0-9-]+$/, 'Cloud Build identity is required');
console.log(`Validated build context for commit ${commit}`);
