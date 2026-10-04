import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READING_PAGES, renderReadingPage } from './reading-pages.mjs';
import { loadHintBank, hintRuntimeSource } from './research/starting-hints/export.mjs';

const files = [
  'index.html', 'styles.css', 'app.js', 'country-search.js', 'game-state.js',
  'game-tools.js', 'geography.js', 'hint-selection.js', 'data.js', 'logo.svg', 'favicon.svg',
  'DATA_SOURCES.md', 'DATA_LICENSE.txt', 'reading-pages.css',
  'fonts/manrope-latin.woff2', 'fonts/manrope-latin-ext.woff2', 'fonts/manrope-OFL.txt',
];

/** Stage a complete static export before replacing the previous successful build. */
export async function buildSite(root = import.meta.dirname) {
  await Promise.all(files.map(file => stat(join(root, file))));
  const bank = await loadHintBank(root);
  const pages = await Promise.all(READING_PAGES.map(async page => [page.name,
    renderReadingPage(page, await readFile(join(root, page.source), 'utf8')),
  ]));
  const generated = [...pages, ['starting-hints.js', hintRuntimeSource(bank)],
    ['starting-hints.json', JSON.stringify(bank) + '\n']];
  const staging = await mkdtemp(join(root, '.build-'));
  const destination = join(root, 'dist');
  const output = join(staging, 'dist');
  const previous = join(staging, 'previous');
  let cleanStaging = true;
  try {
    await mkdir(join(output, 'fonts'), { recursive: true });
    // Wait for all writes to settle before cleanup, even if one copy fails.
    const results = await Promise.allSettled([
      ...files.map(file => cp(join(root, file), join(output, file), { recursive: true })),
      ...generated.map(([name, content]) => writeFile(join(output, name), content)),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    let hadPrevious = false;
    try {
      await rename(destination, previous);
      hadPrevious = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      await rename(output, destination);
    } catch (error) {
      if (hadPrevious) {
        // Preserve the backup if recovery itself fails; never delete the only
        // remaining successful export while reporting a failed replacement.
        cleanStaging = false;
        await rename(previous, destination);
        cleanStaging = true;
      }
      throw error;
    }
    return destination;
  } finally {
    if (cleanStaging) await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log('Static Ländle files are ready in dist/.');
}
