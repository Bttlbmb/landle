import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../build.mjs';

test('static export removes obsolete files and includes only deployable assets and attribution', async t => {
  const root = await mkdtemp(join(tmpdir(), 'landle-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(import.meta.dirname, '..');
  // Use real inputs without copying historical artifacts or a previous export.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile() || entry.name === 'fonts') {
      await cp(join(source, entry.name), join(root, entry.name), { recursive: true });
    }
  }
  await mkdir(join(root, 'dist', 'fonts'), { recursive: true });
  await writeFile(join(root, 'dist', 'old.html'), 'obsolete');
  await writeFile(join(root, 'dist', 'fonts', 'old.woff2'), 'obsolete');
  const destination = await buildSite(root);
  const exported = await readdir(destination);
  assert.ok(exported.includes('index.html'));
  assert.ok(exported.includes('starting-hints.js'));
  assert.ok(exported.includes('hint-selection.js'));
  assert.deepEqual(await readFile(join(destination, 'starting-hints.js')), await readFile(join(source, 'starting-hints.js')));
  assert.ok(exported.includes('DATA_SOURCES.md'));
  assert.ok(exported.includes('DATA_LICENSE.txt'));
  for (const name of ['data-sources.html', 'licence.html', 'reading-pages.css']) assert.ok(exported.includes(name), name);
  for (const excluded of ['old.html', 'server.mjs', 'build.mjs', 'package.json', 'README.md', 'QA_NOTES.md']) {
    assert.ok(!exported.includes(excluded), excluded);
  }
  assert.ok(!(await readdir(join(destination, 'fonts'))).includes('old.woff2'));
  async function checkBytes(directory = '') {
    for (const entry of await readdir(join(destination, directory), { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await checkBytes(file);
      else assert.deepEqual(await readFile(join(destination, file)), await readFile(join(root, file)), file);
    }
  }
  await checkBytes();
});

test('missing source inputs leave the previous export intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'landle-build-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.html'), 'previous export');
  await assert.rejects(buildSite(root), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'dist', 'index.html'), 'utf8'), 'previous export');
});
