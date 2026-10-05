import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../build.mjs';
import { READING_PAGES, renderReadingPage } from '../reading-pages.mjs';

for (const outputDirectory of ['dist', 'docs']) {
  test(`${outputDirectory} export removes obsolete files and includes only deployable assets and attribution`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'landle-build-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(import.meta.dirname, '..');
    // Use real inputs without copying historical artifacts or a previous export.
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isFile() || entry.name === 'fonts') {
        await cp(join(source, entry.name), join(root, entry.name), { recursive: true });
      }
    }
    await mkdir(join(root, 'research', 'starting-hints'), { recursive: true });
    for (const file of ['revised-accuracy-review.json', 'revised-fairness-review.json']) {
      await cp(join(source, 'research/starting-hints', file), join(root, 'research/starting-hints', file));
    }
    await writeFile(join(root, 'fonts', 'unreferenced.woff2'), 'unused source font');
    await mkdir(join(root, outputDirectory, 'fonts'), { recursive: true });
    await writeFile(join(root, outputDirectory, 'old.html'), 'obsolete');
    await writeFile(join(root, outputDirectory, 'fonts', 'old.woff2'), 'obsolete');
    const destination = await buildSite(root, outputDirectory);
    assert.equal(destination, join(root, outputDirectory));
    const exported = await readdir(destination);
    assert.ok(exported.includes('index.html'));
    assert.ok(exported.includes('.nojekyll'));
    assert.ok(exported.includes('starting-hints.js'));
    assert.ok(exported.includes('hint-selection.js'));
    assert.deepEqual(await readFile(join(destination, 'starting-hints.js')), await readFile(join(source, 'starting-hints.js')));
    assert.ok(exported.includes('DATA_SOURCES.md'));
    assert.ok(exported.includes('DATA_LICENSE.txt'));
    for (const name of ['data-sources.html', 'licence.html', 'reading-pages.css']) assert.ok(exported.includes(name), name);
    for (const excluded of ['old.html', 'server.mjs', 'build.mjs', 'package.json', 'README.md', 'QA_NOTES.md']) {
      assert.ok(!exported.includes(excluded), excluded);
    }
    assert.deepEqual((await readdir(join(destination, 'fonts'))).sort(),
      ['manrope-OFL.txt', 'manrope-latin-ext.woff2', 'manrope-latin.woff2']);
    async function checkBytes(directory = '') {
      for (const entry of await readdir(join(destination, directory), { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await checkBytes(file);
        else {
          const page = READING_PAGES.find(page => page.name === file);
          if (file === '.nojekyll') assert.equal(await readFile(join(destination, file), 'utf8'), '');
          else if (page) assert.equal(await readFile(join(destination, file), 'utf8'),
            renderReadingPage(page, await readFile(join(root, page.source), 'utf8')));
          else if (file === 'starting-hints.json') assert.deepEqual(JSON.parse(await readFile(join(destination, file), 'utf8')),
            JSON.parse(await readFile(join(root, file), 'utf8')));
          else assert.deepEqual(await readFile(join(destination, file)), await readFile(join(root, file)), file);
        }
      }
    }
    await checkBytes();
  });

  test(`missing source inputs leave the previous ${outputDirectory} export intact`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'landle-build-missing-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, outputDirectory));
    await writeFile(join(root, outputDirectory, 'index.html'), 'previous export');
    await assert.rejects(buildSite(root, outputDirectory), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, outputDirectory, 'index.html'), 'utf8'), 'previous export');
  });
}
