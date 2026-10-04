// Optional cross-engine keyboard regression; reports are generated artifacts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPreviewServer } from '../server.mjs';
const require = createRequire(import.meta.url);
const { webkit, chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = new URL('../artifacts/audit/', import.meta.url);
const server = createPreviewServer();
const records = [];
const stage = 'keyboard';
// Match the game's conservative reserve for keyboard accessory controls.
const ACCESSORY_SPACE = 80;
const engine = process.env.PROBE_ENGINE || 'webkit';
if (!['webkit', 'chromium'].includes(engine)) throw new Error('PROBE_ENGINE must be webkit or chromium.');
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true,
    ...(engine === 'chromium' && process.env.BROWSER_BIN ? { executablePath: process.env.BROWSER_BIN } : {}),
  });
  for (const height of [240, 240.5, 280.333333, 300.666667, 360.25, 400.5]) {
    for (const offsetTop of [0, 60.5, 120.125]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.addInitScript(({ height, offsetTop }) => {
        const viewport = window.visualViewport;
        Object.defineProperty(viewport, 'height', { get: () => height });
        Object.defineProperty(viewport, 'offsetTop', { get: () => offsetTop });
        window.scrollTrace = [];
        const scroll = window.scrollBy.bind(window);
        window.scrollBy = (...args) => {
          const before = scrollY;
          scroll(...args);
          const input = document.querySelector('#country-search').getBoundingClientRect();
          window.scrollTrace.push({ time: performance.now(), delta: args[0].top, before, after: scrollY,
            inputTop: input.top, inputBottom: input.bottom,
            maxHeight: document.querySelector('#country-options').style.getPropertyValue('--options-max-height') });
          // Mobile engines report visual-viewport scrolling after document movement.
          // Desktop headless engines do not, so deliver that missing notification.
          if (before !== scrollY) requestAnimationFrame(() => viewport.dispatchEvent(new Event('scroll')));
        };
      }, { height, offsetTop });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#country-search').focus();
      await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(160);
      const beforeTyping = await page.evaluate(accessorySpace => {
        const input = document.querySelector('#country-search').getBoundingClientRect();
        return { top: input.top, bottom: input.bottom, accessoryTop: visualViewport.offsetTop + visualViewport.height - accessorySpace };
      }, ACCESSORY_SPACE);
      await page.evaluate(() => { window.scrollTrace = []; });
      await page.keyboard.insertText('n');
      await page.waitForTimeout(650);
      // A run of viewport notifications must not trigger document corrections.
      await page.evaluate(() => new Promise(resolve => {
        let frames = 0;
        const notify = () => {
          visualViewport.dispatchEvent(new Event('scroll'));
          visualViewport.dispatchEvent(new Event('resize'));
          if (++frames < 60) requestAnimationFrame(notify); else resolve();
        };
        requestAnimationFrame(notify);
      }));
      const trace = await page.evaluate(() => window.scrollTrace);
      const geometry = await page.evaluate(accessorySpace => {
        const input = document.querySelector('#country-search').getBoundingClientRect();
        const list = document.querySelector('#country-options').getBoundingClientRect();
        const form = document.querySelector('#guess-form');
        return { inputTop: input.top, inputBottom: input.bottom, listTop: list.top, listBottom: list.bottom,
          viewportTop: visualViewport.offsetTop, accessoryTop: visualViewport.offsetTop + visualViewport.height - accessorySpace,
          formPosition: getComputedStyle(form).position, formTop: form.getBoundingClientRect().top,
          boardBottom: document.querySelector('#guess-board').getBoundingClientRect().bottom };
      }, ACCESSORY_SPACE);
      const result = { engine, height, offsetTop, beforeTyping, trace, geometry,
        reversals: trace.slice(1).filter((step, index) => step.delta * trace[index].delta < 0).length };
      records.push(result);
      if (trace.length > 5) console.log(JSON.stringify({ height, offsetTop, calls: trace.length, reversals: result.reversals, deltas: trace.slice(0, 8).map(step => step.delta) }));
      await context.close();
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(new URL(`${stage}-${engine}.json`, output), JSON.stringify({ engine, stage, version: browser.version(), records }, null, 2));
  const oscillating = records.filter(record => record.reversals > 4);
  const hiddenBeforeTyping = records.filter(record => record.beforeTyping.bottom > record.beforeTyping.accessoryTop);
  console.log(JSON.stringify({ engine, scenarios: records.length, oscillating: oscillating.length, hiddenBeforeTyping: hiddenBeforeTyping.length,
    maximumScrollCalls: Math.max(...records.map(record => record.trace.length)) }));
  assert.equal(oscillating.length, 0, 'Typing must not start a scrolling loop');
  assert.equal(hiddenBeforeTyping.length, 0, 'The empty field must clear the accessory bar');
  assert.ok(records.every(record => record.geometry.inputBottom <= record.geometry.accessoryTop), 'The typed field must clear the accessory bar');
  assert.ok(records.every(record => record.trace.length === 0), 'Keyboard viewport events must never scroll the document');
  assert.ok(records.every(record => record.geometry.formPosition === 'relative' && record.geometry.formTop >= record.geometry.boardBottom), 'Entry stays in normal flow below the board');
} finally {
  await browser?.close();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
