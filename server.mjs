import { createServer } from 'node:http';
import { createReadStream, realpathSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { READING_PAGES, renderReadingPage } from './reading-pages.mjs';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** A local static preview, also reusable by browser checks with a temporary port. */
export function createPreviewServer(root = import.meta.dirname) {
  const directory = realpathSync(root);
  return createServer(async (request, response) => {
    const reply = (status, message, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      reply(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }

    let name;
    try {
      name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (name.includes('\0')) throw new Error('Invalid path');
    } catch {
      reply(400, 'Invalid path');
      return;
    }

    try {
      // Reader pages come from their Markdown/licence source in local preview.
      const document = READING_PAGES.find(page => '/' + page.name === name);
      const candidate = resolve(directory, `.${document ? '/' + document.source : name === '/' ? '/index.html' : name}`);
      // Check both spelling and destination: a symlink must not expose other files.
      if (!candidate.startsWith(directory + sep) || name.split('/').some(part => part.startsWith('.'))) {
        reply(403, 'Forbidden');
        return;
      }
      const path = await realpath(candidate);
      if (!path.startsWith(directory + sep) || relative(directory, path).split(sep).some(part => part.startsWith('.'))) {
        reply(403, 'Forbidden');
        return;
      }
      const details = await stat(path);
      if (!details.isFile()) {
        reply(404, 'Not found');
        return;
      }
      const body = document ? renderReadingPage(document, await readFile(path, 'utf8')) : null;
      response.writeHead(200, {
        'Content-Type': types[document ? '.html' : extname(path)] || 'application/octet-stream',
        'Content-Length': body === null ? details.size : Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else if (body !== null) response.end(body);
      else await pipeline(createReadStream(path), response);
    } catch (error) {
      // Once streaming starts, close a failed response instead of sending two headers.
      if (response.headersSent) response.destroy();
      else if (['ENOENT', 'ENOTDIR'].includes(error.code)) reply(404, 'Not found');
      else reply(500, 'Unable to read file');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT === undefined ? 5173 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a whole number from 1 to 65535.');
    process.exitCode = 1;
  } else {
    createPreviewServer().on('error', error => {
      console.error(`Could not start the preview: ${error.message}`);
      process.exitCode = 1;
    }).listen(port, '127.0.0.1', () => {
      console.log(`Ländle is running at http://localhost:${port}`);
    });
  }
}
