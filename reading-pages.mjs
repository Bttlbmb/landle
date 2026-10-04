/** Escape document text before adding the small amount of reader-page markup. */
const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export const READING_PAGES = Object.freeze([
  Object.freeze({ name: 'data-sources.html', source: 'DATA_SOURCES.md', title: 'Data sources and attribution' }),
  Object.freeze({ name: 'licence.html', source: 'DATA_LICENSE.txt', title: 'Database licence' }),
]);

function inline(text) {
  // This deliberately supports only the Markdown used by DATA_SOURCES.md.
  // A single pass keeps inserted HTML out of later text substitutions.
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let html = '', offset = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(offset, match.index));
    const [, code, strong, label, href] = match;
    if (code !== undefined) html += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined) html += `<strong>${escapeHtml(strong)}</strong>`;
    else {
      if (!/^(https?:\/\/|[\w./-]+(?:#[\w-]+)?$)/.test(href)) throw new Error('Unsupported document link: ' + href);
      html += `<a href="${escapeHtml(href)}">${inline(label)}</a>`;
    }
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(offset));
}

/** Paragraphs, headings and tables cover the source document without a dependency. */
export function markdownToHtml(source) {
  return source.trim().split(/\n\s*\n/).map(block => {
    const heading = /^(#{1,3}) (.+)$/.exec(block);
    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (block.startsWith('|')) {
      const rows = block.split('\n').map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim()));
      if (rows.length < 2 || !rows[1].every(cell => /^:?-{3,}:?$/.test(cell))
          || rows.some(row => row.length !== rows[0].length)) throw new Error('Malformed document table.');
      const cells = (row, tag) => '<tr>' + row.map(cell => `<${tag}>${inline(cell)}</${tag}>`).join('') + '</tr>';
      return '<table><thead>' + cells(rows[0], 'th') + '</thead><tbody>'
        + rows.slice(2).map(row => cells(row, 'td')).join('') + '</tbody></table>';
    }
    if (/^(?:#{1,6} |[-*>] |```)/m.test(block)) throw new Error('Unsupported document Markdown block.');
    return `<p>${inline(block.replaceAll('\n', ' '))}</p>`;
  }).join('\n');
}

/** The preview and export generate the same page from one authoritative source. */
export function renderReadingPage(page, source) {
  const licence = page.name === 'licence.html';
  const article = licence
    ? '<h1>Database licence</h1><p>The country database uses the Open Database Licence 1.0. The original text follows.</p><pre>' + escapeHtml(source) + '</pre>'
    : markdownToHtml(source);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f0f4f2">
  <title>Ländle — ${escapeHtml(page.title)}</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="reading-pages.css">
</head>
<body class="reading-page">
  <header class="site-header">
    <a class="brand" href="index.html" aria-label="Ländle home"><img class="brand-icon" src="logo.svg" width="20" height="20" alt="" aria-hidden="true"><span>Ländle<span class="brand-dot">.</span></span></a>
    <a class="reading-back" href="index.html">Back to game</a>
  </header>
  <main class="reading-shell">
    <article>${article}</article>
    <footer class="reading-footer"><a href="${licence ? 'data-sources.html' : 'licence.html'}">${licence ? 'Data sources and attribution' : 'Database licence'}</a><a href="${page.source}" download>Download original ${licence ? 'licence' : 'source document'}</a></footer>
  </main>
</body>
</html>
`;
}
