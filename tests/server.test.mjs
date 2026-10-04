import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createPreviewServer } from '../server.mjs';

let temporary, server, port;
test.before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'landle-server-'));
  const root = join(temporary, 'site');
  await mkdir(root);
  await writeFile(join(root, 'index.html'), '<title>Ländle</title>');
  await writeFile(join(root, 'styles.css'), 'body { color: black; }');
  await writeFile(join(root, '.private'), 'private');
  await writeFile(join(temporary, 'outside.txt'), 'outside');
  await symlink(join(temporary, 'outside.txt'), join(root, 'escape.txt'));
  await symlink(join(root, '.private'), join(root, 'hidden-alias.txt'));
  await symlink(join(root, 'styles.css'), join(root, 'alias.css'));
  await mkdir(join(root, 'fonts'));
  server = createPreviewServer(root).listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});
test.after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

// Raw request paths keep traversal spellings intact, unlike URL-normalizing clients.
function read(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const pending = request({ hostname: '127.0.0.1', port, path, method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    pending.on('error', reject);
    pending.end();
  });
}

test('preview serves the homepage and assets with correct types and byte counts', async () => {
  const homepage = await read('/?preview=1');
  assert.equal(homepage.status, 200);
  assert.equal(homepage.body, '<title>Ländle</title>');
  assert.equal(homepage.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(Number(homepage.headers['content-length']), Buffer.byteLength(homepage.body));
  assert.equal(homepage.headers['cache-control'], 'no-cache');
  assert.equal(homepage.headers['x-content-type-options'], 'nosniff');
  const stylesheet = await read('/alias.css');
  assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers['content-type'], 'text/css; charset=utf-8');
});

test('HEAD returns the same metadata without a body and mutation methods are rejected', async () => {
  const head = await read('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(head.body, '');
  const post = await read('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('preview blocks traversal, hidden files and symlinks leading outside its root', async () => {
  for (const path of ['/..%2foutside.txt', '/.private', '/%2eprivate', '/escape.txt', '/hidden-alias.txt']) {
    const response = await read(path);
    assert.equal(response.status, 403, path);
    assert.equal(response.body, 'Forbidden', path);
  }
});

test('malformed paths get a clear error; missing files and directories get no listing', async () => {
  for (const path of ['/%', '/%00']) assert.equal((await read(path)).status, 400, path);
  for (const path of ['/missing.html', '/fonts/', '/styles.css/child']) {
    assert.equal((await read(path)).status, 404, path);
  }
  assert.equal((await read('/missing.html', 'HEAD')).body, '');
});
