import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createGameServer } from '../server';
import { smokeDeployment } from '../deployment-smoke';

test('deployment checks refuse the wrong commit before starting a game and health has no credentials', async () => {
  const app = createGameServer();
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/`;
  try {
    const response = await fetch(`${base}healthz`); const body = await response.json() as object;
    assert.deepEqual(Object.keys(body).sort(), ['status', 'version']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await assert.rejects(smokeDeployment(base, 'definitely-wrong-commit'), /Wrong deployed commit/);
    assert.equal(app.manager.size, 0);
    await assert.rejects(smokeDeployment('http://user:password@localhost/'), /credentials/);
  } finally { await app.close(); }
});
