import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { createGameServer } from '../server';
import { smokeDeployment } from '../deployment-smoke';

test('deployment checks refuse the wrong commit before starting a game and health has no credentials', async () => {
  const app = createGameServer();
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/`;
  try {
    const response = await fetch(`${base}api/health`); const body = await response.json() as object;
    assert.deepEqual(Object.keys(body).sort(), ['status', 'version']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await assert.rejects(smokeDeployment(base, 'definitely-wrong-commit'), /Wrong deployed commit/);
    assert.equal(app.manager.size, 0);
    await assert.rejects(smokeDeployment('http://user:password@localhost/'), /credentials/);
  } finally { await app.close(); }
});

test('deployment health failures identify the endpoint and reject frontend HTML', async () => {
  let status = 404;
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? '');
    res.writeHead(status, { 'Content-Type': 'text/html' }); res.end('<html>frontend fallback</html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    await assert.rejects(smokeDeployment(base), /Health endpoint \/api\/health returned HTTP 404/);
    status = 200;
    await assert.rejects(smokeDeployment(base), /Health endpoint must return JSON/);
    assert.deepEqual(paths, ['/api/health', '/api/health']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
