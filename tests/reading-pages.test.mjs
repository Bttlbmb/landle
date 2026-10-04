import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { markdownToHtml, READING_PAGES, renderReadingPage } from '../reading-pages.mjs';

test('reader renders headings, comparisons, table cells and links without executing source HTML', () => {
  const source = '# Data <script>\n\nUse **2024** figures and `x < y`. [Source](https://example.com/?x=1&y=2)\n\n| Clue | Meaning |\n| --- | --- |\n| ↑ | More & larger |';
  const html = markdownToHtml(source);
  assert.ok(html.includes('<h1>Data &lt;script&gt;</h1>'));
  assert.ok(html.includes('<strong>2024</strong>'));
  assert.ok(html.includes('<code>x &lt; y</code>'));
  assert.ok(html.includes('href="https://example.com/?x=1&amp;y=2"'));
  assert.ok(html.includes('<td>More &amp; larger</td>'));
  assert.throws(() => markdownToHtml('[Link](javascript:alert)'), /Unsupported document link/);
  assert.throws(() => markdownToHtml('| One | Two |\n| --- | --- |\n| Missing |'), /Malformed document table/);
});

test('licence reader retains every character of the original legal text', async () => {
  const source = await readFile(new URL('../DATA_LICENSE.txt', import.meta.url), 'utf8');
  const page = renderReadingPage(READING_PAGES.find(page => page.name === 'licence.html'), source);
  const decoded = page.match(/<pre>([\s\S]*?)<\/pre>/)[1].replace(/&(amp|lt|gt|quot|#39);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
  assert.equal(decoded, source);
  assert.ok(page.includes('href="DATA_LICENSE.txt" download'));
});
