import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { parseDocument } = require('yaml');
const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Cloud Build parses with unique keys, gates image publication and only deploys a preview', () => {
  const document = parseDocument(read('../../cloudbuild.yaml'));
  assert.deepEqual(document.errors, []); const config = document.toJS();
  assert.deepEqual(config.steps.map(step => step.id), ['ValidateContext', 'BuildAndVerifyLinux', 'Push', 'DeployPreview', 'SmokePreview']);
  assert.ok(config.steps[1].args.includes('BUILD_COMMIT=$COMMIT_SHA'));
  assert.equal(config.steps[3].args[0], 'scripts/deploy-preview.sh');
  assert.ok(!JSON.stringify(config.steps).includes('update-traffic'));
  const preview = read('../deploy-preview.sh');
  assert.match(preview, /--no-traffic/); assert.match(preview, /--revision-suffix=/); assert.match(preview, /--tag=/);
  assert.doesNotMatch(preview, /--to-latest|update-traffic|--allow-unauthenticated|--no-invoker-iam-check/);
  const docker = read('../../Dockerfile');
  assert.match(docker, /COPY --from=verify/); assert.match(docker, /npm test && npm run test:deployment && npm run verify:challenges/);
  assert.match(docker, /--self-host --expect-version/); assert.match(docker, /sha256sum --check/);
  const ignore = read('../../.dockerignore'); assert.match(ignore, /\*\*\/node_modules/); assert.match(ignore, /\*\*\/\.env/);
});
