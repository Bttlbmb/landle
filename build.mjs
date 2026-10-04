import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = [
  'index.html', 'styles.css', 'app.js', 'country-search.js', 'game-state.js',
  'game-tools.js', 'geography.js', 'hint-selection.js', 'data.js', 'starting-hints.js', 'starting-hints.json', 'logo.svg', 'favicon.svg',
  'DATA_SOURCES.md', 'DATA_LICENSE.txt', 'data-sources.html', 'licence.html', 'reading-pages.css', 'fonts',
];

/** Gather the static site. Recreating dist prevents old exports from leaking into it. */
export async function buildSite(root = import.meta.dirname) {
  // Verify the inputs before replacing the previous export.
  await Promise.all(files.map(file => stat(join(root, file))));
  const destination = join(root, 'dist');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  await Promise.all(files.map(file => cp(join(root, file), join(destination, file), { recursive: true })));
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log('Static Ländle files are ready in dist/. No server is needed by the game.');
}
