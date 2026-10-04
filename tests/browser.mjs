import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewServer } from '../server.mjs';

// Optional integration checks use Chromium's built-in debugging interface.
// Each run gets a temporary profile; no personal browser or saved game is touched.
const executable = process.env.BROWSER_BIN;
if (!executable || typeof WebSocket === 'undefined') {
  console.error('Use Node.js 22 or newer and set BROWSER_BIN to a Chromium executable.');
  process.exit(1);
}
const output = new URL('../artifacts/audit/', import.meta.url);
const profile = await mkdtemp(join(tmpdir(), 'landle-browser-'));
const server = createPreviewServer();
let browser;
let socket;
const pending = new Map();
const errors = [];
const checks = [];
let sequence = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const EMPTY_MESSAGE = '';

function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser request timed out: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function until(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${description}`);
}

async function openPage(width, height, context, path = '/') {
  const shared = Boolean(context);
  const browserContextId = context || (await call('Target.createBrowserContext')).browserContextId;
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  const evaluate = async (fn, ...args) => {
    const expression = typeof fn === 'string' ? fn : `(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`;
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: width <= 430 });
  const url = `http://127.0.0.1:${server.address().port}${path}`;
  const navigate = async () => {
    await evaluate(() => { window.awaitingNavigation = true; });
    const navigation = await send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(navigation.errorText);
    await until(() => evaluate(() => !window.awaitingNavigation && document.readyState === 'complete' && document.querySelectorAll('.guess-row').length === 6), 'game load');
    await evaluate(() => document.fonts.ready.then(() => true));
  };
  const reload = async () => {
    await evaluate(() => { window.awaitingNavigation = true; });
    await send('Page.reload');
    await until(() => evaluate(() => !window.awaitingNavigation && document.readyState === 'complete' && document.querySelectorAll('.guess-row').length === 6), 'game reload');
    await evaluate(() => document.fonts.ready.then(() => true));
    assert.equal(await evaluate(() => document.querySelector('#game-message').textContent), EMPTY_MESSAGE, 'Reload omits the initial prompt');
  };
  await navigate();
  const click = async selector => {
    await evaluate(s => document.querySelector(s).click(), selector);
    await pause(30);
  };
  const fill = value => evaluate(text => {
    const input = document.querySelector('#country-search');
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const key = async key => {
    const code = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 }[key];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
    await pause(30);
  };
  const guess = async value => { await fill(value); await click('#guess-button'); await pause(220); };
  const rows = () => evaluate(() => document.querySelectorAll('.guess-row.filled').length);
  const fixture = async (options = {}) => {
    // Deliberate fixtures exercise rare outcomes without changing real gameplay.
    await evaluate(async options => {
      const game = await import('./game-state.js');
      const { countriesForRound, chooseOpeningHint } = await import('./geography.js');
      const state = game.newStore();
      const target = options.target || 'JP';
      const prefixTargets = (options.prefixTargets || ['FR', 'IT', 'AU']).filter(code => code !== target);
      const targets = options.previousTargets
        ? [...options.previousTargets, target]
        : [...prefixTargets.slice(0, (options.tier || 1) - 1), target];
      const firstIndex = countriesForRound(1).findIndex(country => country.code === targets[0]);
      if (firstIndex < 0) throw new Error('Fixture needs an Easy starting country.');
      state.rounds.push(game.createPuzzle(1, { random: firstIndex }));
      for (const nextTarget of targets.slice(1)) {
        const earlier = game.getPuzzle(state);
        if (!game.recordGuess(state, earlier, earlier.target).ok) throw new Error('Fixture could not finish its prefix.');
        const nextTier = state.tier === 3 ? 1 : state.tier + 1;
        const exclusions = [...new Set([...state.recentAnswers.map(entry => entry.code), ...state.rounds.map(round => round.target)])];
        const pool = countriesForRound(nextTier, exclusions);
        const random = pool.findIndex(country => country.code === nextTarget);
        if (random < 0 || game.restartPuzzle(state, { random }).target !== nextTarget) throw new Error('Fixture target is unavailable.');
      }
      const puzzle = game.getPuzzle(state);
      if (state.tier !== (options.tier || 1) || puzzle.target !== target) throw new Error('Fixture did not reach its requested round.');
      if (options.roundId) {
        const previousId = puzzle.roundId;
        puzzle.roundId = options.roundId;
        puzzle.hintId = chooseOpeningHint({ code: puzzle.target }, puzzle.roundId, puzzle.tier, puzzle.excludedCodes).id;
        state.recentHints = state.recentHints.filter(entry => entry.roundId !== previousId);
        game.getPuzzle(state);
      }
      for (const code of options.guesses || []) game.recordGuess(state, puzzle, code);
      localStorage.setItem('landle-v1', JSON.stringify(state));
    }, options);
    await navigate();
  };
  const reviewedHint = async () => {
    const board = await evaluate(async () => {
      const { COUNTRIES } = await import('./data.js');
      const { countriesForRound, openingHintsFor } = await import('./geography.js');
      const { getOpeningHint } = await import('./game-state.js');
      const { STARTING_HINTS, HINT_BANK_VERSION, HINT_RULES } = await import('./starting-hints.js');
      const state = JSON.parse(localStorage.getItem('landle-v1'));
      const current = state.rounds[state.tier - 1];
      const target = COUNTRIES.find(country => country.code === current.target);
      const pool = countriesForRound(current.tier, current.excludedCodes);
      const eligible = STARTING_HINTS[current.target].filter(hint => {
        if (!hint.eligibleTiers.includes(current.tier)) return false;
        const confirmed = pool.filter(country => hint.matches.includes(country.code)).length;
        const maximum = pool.filter(country => [...hint.matches, ...hint.possibleExtraMatches].includes(country.code)).length;
        return confirmed >= HINT_RULES.minimumMatches && maximum >= HINT_RULES.minimumPossibleMatches[current.tier]
          && maximum / pool.length <= HINT_RULES.maximumFraction;
      });
      return {
        tier: current.tier,
        target: current.target,
        roundId: current.roundId,
        excludedCodes: current.excludedCodes,
        poolSize: pool.length,
        text: document.querySelector('#opening-hint').textContent,
        expected: getOpeningHint(current),
        eligible,
        runtimeEligible: openingHintsFor(target, current.tier, current.excludedCodes),
        countries: Object.keys(STARTING_HINTS).length,
        version: HINT_BANK_VERSION,
        localModuleLoaded: performance.getEntriesByType('resource').some(resource => {
          const url = new URL(resource.name);
          return url.origin === location.origin && url.pathname.endsWith('/starting-hints.js');
        }),
      };
    });
    assert.equal(board.text, board.expected, 'Visible hint uses the active country, round identity, and difficulty');
    assert.ok(board.eligible.some(hint => hint.text === board.text), 'Visible hint is an eligible reviewed clue for this country');
    assert.deepEqual(board.runtimeEligible, board.eligible, 'Runtime candidates match the reviewed bank');
    assert.equal(board.countries, 195, 'All country hints load in the browser');
    assert.ok(board.version && board.localModuleLoaded, 'Reviewed hints load from the local module');
    return board;
  };
  const geometry = selectors => evaluate(selectors => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    elements: selectors.map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { selector, top: rect.top, bottom: rect.bottom, height: rect.height };
    }), height: innerHeight,
  }), selectors);
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 });
    await writeFile(new URL(`${name}.jpg`, output), Buffer.from(data, 'base64'));
  };
  return { evaluate, send, context: browserContextId, navigate, reload, click, fill, key, guess, rows, fixture, reviewedHint, geometry, screenshot,
    close: () => shared ? call('Target.closeTarget', { targetId }) : call('Target.disposeBrowserContext', { browserContextId }) };
}

function visible(geometry, label) {
  assert.ok(geometry.scrollWidth <= geometry.width, `${label}: horizontal overflow`);
  for (const element of geometry.elements) {
    assert.ok(element.height > 0 && element.top >= -1 && element.bottom <= geometry.height + 1,
      `${label}: ${element.selector} outside viewport: ${JSON.stringify(element)}`);
  }
}

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  await mkdir(output, { recursive: true });
  browser = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError;
  browser.on('error', error => { launchError = error; });
  let endpoint;
  let launchLog = '';
  browser.stderr.on('data', chunk => {
    launchLog += chunk;
    endpoint = launchLog.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
  });
  await until(() => {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error(`Chromium stopped: ${launchLog}`);
    return endpoint;
  }, 'Chromium startup');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === 'Runtime.exceptionThrown') errors.push(response.params.exceptionDetails.text);
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result);
  });

  for (const [width, height] of [[320, 568], [360, 640], [375, 568], [376, 568], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [844, 390]]) {
    const page = await openPage(width, height);
    const initial = await page.geometry(['h1', '.task-instruction', '#guess-form', '.status-line']);
    if (height > 500) visible(initial, 'Initial board');
    else assert.ok(initial.scrollWidth <= width, 'Landscape overflow');
    assert.equal(await page.evaluate(() => document.querySelector('.intro .eyebrow, .site-footer')), null, 'Slogan and footer are removed');
    assert.equal(await page.evaluate(() => document.querySelector('#stats-button, #journey-progress, .journey-track')), null, 'Statistics button and bottom journey information are removed');
    assert.equal(await page.evaluate(() => document.querySelector('#daily-mode, #journey-mode, #level-button, .mode-switch')), null, 'Daily and mode controls are removed');
    assert.equal(await page.evaluate(() => /\b(?:Daily|Familiar|World|Explorer)\b/.test(document.body.textContent)), false, 'Journey uses only Easy, Medium, and Hard');
    assert.equal(await page.evaluate(() => document.querySelector('.task-instruction').textContent), 'Three rounds, six guesses each: Easy → Medium → Hard.');
    assert.ok(await page.evaluate(() => ['body', 'h1'].every(selector => getComputedStyle(document.querySelector(selector)).fontFamily.startsWith('Manrope'))), 'Manrope styles the game and heading');
    assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family.replace(/["']/g, '') === 'Manrope' && font.status === 'loaded')), 'Manrope font is loaded');
    assert.ok(await page.evaluate(() => performance.getEntriesByType('resource').some(resource => {
      const url = new URL(resource.name);
      return url.origin === location.origin && /\/fonts\/.*manrope.*\.woff2$/i.test(url.pathname);
    })), 'Manrope is served locally');
    const compact = await page.evaluate(() => {
      const header = document.querySelector('.site-header').getBoundingClientRect();
      const heading = document.querySelector('h1').getBoundingClientRect();
      const logo = document.querySelector('.brand-icon').getBoundingClientRect();
      const fontSize = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return { headerHeight: header.height, logoSize: Math.max(logo.width, logo.height), brandFont: fontSize('.brand'), headingFont: fontSize('h1'), instructionFont: fontSize('.task-instruction'), headingGap: heading.top - header.bottom };
    });
    assert.ok(compact.headerHeight <= 56, `Compact header: ${JSON.stringify(compact)}`);
    assert.ok(compact.logoSize <= 20 && compact.brandFont <= 26, `Compact brand: ${JSON.stringify(compact)}`);
    assert.ok(compact.headingFont <= 32 && compact.instructionFont <= 12, `Compact introduction: ${JSON.stringify(compact)}`);
    assert.ok(compact.headingGap <= 24, `Compact heading gap: ${JSON.stringify(compact)}`);
    assert.equal(await page.evaluate(() => document.querySelector('#game-message').textContent), EMPTY_MESSAGE, 'Initial board omits the initial prompt');
    const openingHint = await page.reviewedHint();
    let longestHintLayout;
    if (width === 320 || width === 390) {
      const hintFixture = await page.evaluate(async () => {
        const { COUNTRIES } = await import('./data.js');
        const { openingHintsFor } = await import('./geography.js');
        let longest = '';
        for (const country of COUNTRIES) {
          for (let tier = country.tier; tier <= 3; tier++) {
            for (const hint of openingHintsFor(country, tier)) {
              if (hint.text.length > longest.length) longest = hint.text;
            }
          }
        }
        const node = document.querySelector('#opening-hint');
        const original = node.textContent;
        node.textContent = longest;
        return { original, longest };
      });
      try {
        longestHintLayout = { text: hintFixture.longest, ...await page.geometry(['h1', '#opening-hint', '#guess-form', '.status-line']) };
        visible(longestHintLayout, 'Longest opening hint');
      } finally {
        await page.evaluate(original => { document.querySelector('#opening-hint').textContent = original; }, hintFixture.original);
      }
    }
    if (width === 320 || width === 390 || width === 1440) await page.screenshot(`initial-${width}`);
    checks.push({ check: 'layout', width, height, initial, compact, openingHint, ...(longestHintLayout ? { longestHintLayout } : {}) });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    const hintFixtures = await page.evaluate(async () => {
      const { COUNTRIES } = await import('./data.js');
      const { openingHint, openingHintsFor } = await import('./geography.js');
      const { STARTING_HINTS } = await import('./starting-hints.js');
      const country = COUNTRIES.find(country => country.code === 'JP');
      return STARTING_HINTS.JP.map((hint, index) => {
        const tiers = [...new Set([index % 3 + 1, ...hint.eligibleTiers])];
        const prefix = ['FR', 'IT'];
        const tier = tiers.find(tier => hint.eligibleTiers.includes(tier)
          && openingHintsFor(country, tier, prefix.slice(0, tier - 1)).some(choice => choice.id === hint.id));
        if (!tier) throw new Error(`No fixture tier can show ${hint.id}`);
        const excluded = prefix.slice(0, tier - 1);
        let roundId;
        for (let seed = 0; seed < 2048; seed++) {
          const candidate = `reviewed-hint-${index}-${seed}`;
          if (openingHint(country, candidate, tier, excluded) === hint.text) {
            roundId = candidate;
            break;
          }
        }
        if (!roundId) throw new Error(`No round identity selects reviewed clue ${hint.id}`);
        return { target: country.code, tier, roundId, text: hint.text, family: hint.family };
      });
    });
    assert.ok(hintFixtures.length >= 9, 'The game can use the wider reviewed alternatives');
    assert.ok(hintFixtures.some(hint => hint.family === 'name'), 'Fixture covers a name clue');
    assert.ok(hintFixtures.some(hint => hint.family === 'geography'), 'Fixture covers a country-specific geography clue');
    for (const fixture of hintFixtures) {
      await page.fixture(fixture);
      const hint = await page.reviewedHint();
      assert.equal(hint.text, fixture.text, 'Each reviewed clue can be displayed');
      assert.equal(hint.tier, fixture.tier, 'Hint selection uses the active round difficulty');
      await page.guess('Italy');
      assert.equal((await page.reviewedHint()).text, fixture.text, 'Reviewed clue stays stable after a guess');
    }
    await page.click('#help-button');
    const help = await page.evaluate(() => document.querySelector('#dialog-content').textContent);
    assert.match(help, /displayed English country name/i, 'Help explains which name name clues use');
    assert.match(help, /accents?|diacritics?/i, 'Help explains accented letters');
    assert.match(help, /spaces|hyphens/i, 'Help explains non-letter characters');
    checks.push({ check: 'reviewed-starting-hint-bank', hints: hintFixtures });
    await page.close();
  }

  {
    const first = await openPage(390, 844);
    await first.fixture({ target: 'ES', tier: 1, previousTargets: ['GR', 'IT', 'PT'] });
    const hint = await first.reviewedHint();
    assert.deepEqual(hint.excludedCodes, ['GR', 'IT', 'PT']);
    assert.equal(hint.poolSize, 42, 'The new Easy round excludes the previous journey answers');
    assert.ok(!hint.runtimeEligible.some(choice => choice.id === 'geo-un-location-southern-europe'), 'The only remaining Southern Europe answer cannot reveal itself');
    await first.click('#help-button');
    const listed = await first.evaluate(() => [...document.querySelectorAll('#possible-country-list [data-code]')].map(node => node.dataset.code));
    assert.equal(listed.length, 42, 'Help shows the same available answer pool used for hint fairness');
    assert.ok(['GR', 'IT', 'PT'].every(code => !listed.includes(code)));
    await first.click('.dialog-close');
    await first.guess('JP');
    assert.equal((await first.reviewedHint()).text, hint.text, 'A guess preserves the hint and its original pool');
    const second = await openPage(390, 844, first.context);
    const resumed = await second.reviewedHint();
    assert.equal(resumed.roundId, hint.roundId);
    assert.equal(resumed.text, hint.text, 'A shared tab resumes the same hint with saved exclusions');
    assert.deepEqual(resumed.excludedCodes, hint.excludedCodes);
    checks.push({ check: 'starting-hint-previous-journey-exclusions', target: hint.target, poolSize: hint.poolSize, excludedCodes: hint.excludedCodes, hint: hint.text });
    await second.close();
    await first.fixture({ target: 'NL', tier: 3, prefixTargets: ['FR', 'BE'] });
    const northSea = await first.reviewedHint();
    assert.deepEqual(northSea.excludedCodes, ['FR', 'BE']);
    assert.ok(!northSea.runtimeEligible.some(choice => choice.id === 'geo-north-sea-coast'), 'Five confirmed plus one uncertain answer still fit within six guesses');
    checks.push({ check: 'starting-hint-partial-six-answer-pool', target: northSea.target, excludedCodes: northSea.excludedCodes, hint: northSea.text });
    await first.close();
  }

  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
    const page = await openPage(width, height);
    await page.fixture();
    const initialHint = await page.evaluate(() => document.querySelector('#opening-hint').textContent);
    await page.fill('Fran');
    await page.click('#guess-button');
    assert.equal(await page.rows(), 0, 'Partial name consumes no attempt');
    await page.fill('France');
    await page.key('Enter');
    assert.equal(await page.rows(), 0, 'First Enter selects');
    await page.key('Enter');
    assert.equal(await page.rows(), 1, 'Second Enter guesses');
    assert.equal(await page.evaluate(() => document.querySelector('#opening-hint').textContent), initialHint, 'Opening hint stays stable after a guess');
    await page.guess('FR');
    assert.equal(await page.rows(), 1, 'Duplicate consumes no attempt');
    await page.guess('not a country');
    assert.equal(await page.rows(), 1, 'Unknown country consumes no attempt');
    await page.fixture();
    for (const code of ['VC', 'CD', 'CF', 'ST', 'BA']) await page.guess(code);
    visible(await page.geometry(['.guess-row.filled:nth-child(5)', '#guess-form', '.status-line']), 'Late guesses');
    await page.fill('saint');
    visible(await page.geometry(['#country-options']), 'Suggestions');
    await page.evaluate(() => { window.firstSuggestion = document.querySelector('.country-option'); });
    await page.key('ArrowUp');
    assert.ok(await page.evaluate(() => document.querySelector('.country-option:last-child').getAttribute('aria-selected') === 'true'), 'ArrowUp wraps');
    await page.key('ArrowDown');
    assert.ok(await page.evaluate(() => document.querySelector('.country-option') === window.firstSuggestion && window.firstSuggestion.getAttribute('aria-selected') === 'true'), 'ArrowDown wraps without rebuilding');
    await page.key('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('#country-options').hidden), true);
    await page.guess('Japan');
    visible(await page.geometry(['#result-panel', '#next-button']), 'Sixth guess win');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'next-button');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#result-panel button').length), 1, 'Completed round has one action');
    assert.equal(await page.evaluate(() => document.querySelector('#next-button').firstChild.textContent.trim()), 'Start a new round');
    assert.equal(await page.evaluate(() => /copy results/i.test(document.body.textContent)), false, 'No copy-results reference');
    await page.click('#next-button');
    assert.equal(await page.rows(), 0, 'New round clears finished guesses');
    assert.equal(await page.evaluate(() => document.querySelector('#result-panel').hidden), true, 'New round returns to guessing');
    assert.equal(await page.evaluate(() => document.querySelector('#game-message').textContent), EMPTY_MESSAGE, 'Next round omits the initial prompt');
    await page.fixture({ tier: 3, target: 'CF' });
    await page.guess('Central African Republic');
    visible(await page.geometry(['#result-panel', '#next-button']), 'Long country result');
    await page.fixture();
    for (const code of ['IT', 'CF', 'BA', 'ST', 'US', 'AU']) await page.guess(code);
    assert.equal(await page.evaluate(() => document.querySelector('#result-panel h2').textContent), 'Japan');
    await page.fixture();
    await page.guess('Japan');
    await page.click('#next-button');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Medium');
    await page.reviewedHint();
    await page.click('#help-button');
    await page.evaluate(() => {
      document.querySelector('.help-reference').open = true;
      document.querySelector('#dialog-body').scrollTop = 100000;
    });
    visible(await page.geometry(['.dialog-close']), 'Scrollable Help close');
    await page.click('.dialog-close');
    checks.push({ check: 'input-results-dialogs-progression', width, height });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.fixture({ tier: 3 });
    await page.click('#help-button');
    await page.click('.pool-details:first-of-type summary');
    const total = await page.evaluate(() => document.querySelectorAll('.pool-list [data-code]').length);
    await page.evaluate(() => {
      const input = document.querySelector('#pool-search');
      input.focus(); input.value = 'jp'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pause(80);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pool-list [data-code]:not([hidden])').length), 1, 'Help filter accepts country codes');
    assert.equal(await page.evaluate(() => document.querySelector('.pool-list [data-code]:not([hidden])').textContent), 'Japan');
    assert.ok(await page.evaluate(() => {
      const body = document.querySelector('#dialog-body').getBoundingClientRect();
      return ['#pool-search', '#pool-filter-count', '.pool-list [data-code]:not([hidden])'].every(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.top >= body.top && rect.bottom <= body.bottom;
      });
    }), 'Help keeps its filter and matching country inside the scroll body');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await until(() => page.evaluate(() => document.querySelector('#pool-search').value === ''), 'Help resets a filter hidden by rotation');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pool-list [data-code]:not([hidden])').length), total, 'Rotation restores the whole available pool');
    await page.click('.dialog-close');
    await page.fixture({ tier: 3, target: 'VC', guesses: ['VC'] });
    await page.click('#next-button');
    assert.ok(await page.evaluate(() => document.activeElement.matches('.opening-hint') && scrollY === 0), 'Touch Journey start shows the new hint before entry');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.guess-row').length), 6, 'Responsive round starts retain all six slots');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.fixture({ guesses: ['FR'] });
    await page.fill('saint');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await pause(100);
    assert.equal(await page.evaluate(() => document.querySelector('#country-search').value), 'saint', 'Rotation preserves the typed draft');
    assert.equal(await page.evaluate(() => document.querySelector('#country-options').hidden), true, 'Rotation closes suggestions while showing context');
    visible(await page.geometry(['.opening-hint', '.guess-row.filled']), 'Rotation keeps hint and latest clue visible');
    await page.screenshot('responsive-rotation-context');
    checks.push({ check: 'responsive-help-filter-rotation-round-context' });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.fixture();
    await page.fill('saint');
    const chosen = await page.evaluate(() => document.querySelector('.country-option').textContent);
    const point = await page.evaluate(() => {
      const rect = document.querySelector('.country-option').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(() => page.evaluate(() => document.querySelector('#country-options').hidden), 'touch selection');
    assert.equal(await page.rows(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#country-search').value), chosen);
    await page.guess('Japan');
    await page.click('#next-button');
    assert.equal(await page.rows(), 0, 'New round clears touch-selected result');
    assert.equal(await page.evaluate(() => document.querySelector('#country-search').value), '', 'New round clears country input');
    checks.push({ check: 'touch-selection-and-new-round' });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('Simulated unavailable storage'); } });` });
    await page.navigate();
    await page.guess('France');
    assert.equal(await page.rows(), 1, 'Play continues without storage');
    await page.click('#help-button');
    assert.equal(await page.evaluate(() => document.querySelector('#game-dialog').open), true);
    checks.push({ check: 'unavailable-storage' });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.fixture();
    await page.guess('Japan');
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats);
    await page.evaluate(() => {
      const NativeDate = Date;
      const now = new NativeDate();
      const tomorrow = new NativeDate(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12).getTime();
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [tomorrow])); }
        static now() { return tomorrow; }
      };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.rows(), 1, 'New local day preserves completed board');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Easy');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), stats);
    checks.push({ check: 'no-local-day-rollover' });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.gameTools = {};
      Object.defineProperty(document, 'modelContext', { value: {
        registerTool(tool) { window.gameTools[tool.name] = tool; },
      } });
    ` });
    await page.fixture();
    assert.equal(await page.evaluate(() => 'answer' in window.gameTools.get_landle_board.execute()), false, 'Tools hide unfinished answer');
    assert.equal(await page.evaluate(() => 'mode' in window.gameTools.get_landle_board.execute()), false, 'Tools expose the journey without a mode');
    const hint = await page.evaluate(() => document.querySelector('#opening-hint').textContent);
    await page.reviewedHint();
    assert.equal(await page.evaluate(() => window.gameTools.get_landle_board.execute().openingHint), hint, 'Tool and visible opening hints match');
    await page.evaluate(() => window.gameTools.submit_landle_guess.execute({ country: 'Italy' }));
    assert.equal(await page.rows(), 1);
    assert.equal(await page.evaluate(() => window.gameTools.get_landle_board.execute().openingHint), hint, 'Tool opening hint stays stable after a guess');
    await page.evaluate(async () => {
      const game = await import('./game-state.js');
      const state = game.restoreStore(localStorage.getItem('landle-v1'));
      game.restartPuzzle(state);
      localStorage.setItem('landle-v1', JSON.stringify(state));
    });
    const result = await page.evaluate(() => window.gameTools.submit_landle_guess.execute({ country: 'France' }));
    assert.ok(result.error.includes('round changed'));
    assert.equal(result.board.guesses.length, 0, 'Tools reject stale-round guesses');
    assert.equal(result.board.openingHint, await page.evaluate(() => document.querySelector('#opening-hint').textContent), 'Tool and visible hints match after a changed round');
    await page.reviewedHint();
    checks.push({ check: 'optional-browser-tools' });
    await page.close();
  }

  {
    const first = await openPage(390, 844);
    await first.fixture();
    const second = await openPage(390, 844, first.context);
    const sharedHint = await first.evaluate(() => document.querySelector('#opening-hint').textContent);
    await first.reviewedHint();
    await second.reviewedHint();
    assert.equal(await second.evaluate(() => document.querySelector('#opening-hint').textContent), sharedHint, 'Shared tabs start with the same hint');
    await first.fill('France');
    await first.key('Escape');
    await second.guess('Italy');
    await until(async () => await first.rows() === 1, 'same-round synchronization');
    assert.equal(await first.evaluate(() => document.querySelector('#country-search').value), 'France');
    assert.equal(await first.evaluate(() => document.querySelector('#opening-hint').textContent), sharedHint, 'Synchronized guess preserves the first tab hint');
    assert.equal(await second.evaluate(() => document.querySelector('#opening-hint').textContent), sharedHint, 'Guess preserves the second tab hint');
    await second.reload();
    await until(async () => await first.rows() === 0, 'reload synchronization');
    assert.equal(await first.evaluate(() => document.querySelector('#country-search').value), '', 'New round clears draft');
    assert.equal(await first.evaluate(() => document.querySelector('#opening-hint').textContent), await second.evaluate(() => document.querySelector('#opening-hint').textContent), 'Shared reload uses one stable new hint');
    await first.reviewedHint();
    await second.reviewedHint();
    const target = await first.evaluate(async () => {
      const game = await import('./game-state.js');
      return game.getPuzzle(game.restoreStore(localStorage.getItem('landle-v1'))).target;
    });
    await first.guess(target);
    await until(() => second.evaluate(() => !document.querySelector('#result-panel').hidden), 'finished-round synchronization');
    const stats = await first.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats);
    await second.click('#next-button');
    assert.equal(await second.evaluate(() => document.querySelector('#game-message').textContent), EMPTY_MESSAGE, 'Next round omits the round banner and initial prompt');
    await until(() => first.evaluate(() => document.querySelector('#journey-level-label').textContent === 'Medium'), 'journey progression synchronization');
    await first.reviewedHint();
    await second.reviewedHint();
    assert.equal(await first.rows(), 0, 'Next round clears shared board');
    assert.deepEqual(await first.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), stats, 'Advancing keeps statistics');
    checks.push({ check: 'cross-tab-and-reload' });
    await second.close();
    await first.close();
  }

  {
    const page = await openPage(390, 844);
    await page.fixture();
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-progress').textContent), 'Round 1 of 3');
    await page.guess('Japan');
    await page.click('#next-button');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Medium', 'Win advances to Medium');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-progress').textContent), 'Round 2 of 3');
    await page.reviewedHint();
    const mediumTarget = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).rounds[1].target);
    for (const code of ['JP', 'FR', 'IT', 'AU', 'US', 'CF', 'ST'].filter(code => code !== mediumTarget).slice(0, 6)) await page.guess(code);
    assert.equal(await page.evaluate(() => document.querySelector('#next-button').firstChild.textContent.trim()), 'Start a new round');
    await page.click('#next-button');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Hard', 'Loss advances to Hard');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-progress').textContent), 'Round 3 of 3');
    await page.reviewedHint();
    const hardTarget = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).rounds[2].target);
    await page.guess(hardTarget);
    assert.equal(await page.evaluate(() => document.querySelector('#next-button').firstChild.textContent.trim()), 'Start a new journey');
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats);
    assert.equal(stats.played, 3);
    assert.equal(stats.won, 2);
    await page.click('#next-button');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Easy', 'Completed journey returns to Easy');
    assert.equal(await page.evaluate(() => document.querySelector('#game-message').textContent), EMPTY_MESSAGE, 'New journey omits the initial prompt');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-progress').textContent), 'Round 1 of 3');
    await page.reviewedHint();
    assert.equal(await page.rows(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).rounds.length), 1, 'New journey replaces the three previous rounds');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), stats, 'New journey retains lifetime statistics');
    checks.push({ check: 'three-round-win-loss-and-reset' });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    const stats = { played: 4, won: 2, streak: 1, best: 2, distribution: [1, 1, 0, 0, 0, 0] };
    await page.evaluate(stats => {
      localStorage.setItem('landle-v1', JSON.stringify({
        version: 1, mode: 'daily', tier: 3, dailyTier: 3, journeyTier: 2,
        daily: {}, journeys: {}, wins: [0, 2, 1, 0], stats,
      }));
    }, stats);
    await page.navigate();
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Easy', 'Legacy progress starts a new Easy journey');
    assert.equal(await page.rows(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).version), 2);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), stats, 'Migration preserves lifetime statistics');
    await page.fixture({ tier: 2, guesses: ['IT'] });
    assert.equal(await page.rows(), 1, 'Saved unfinished round resumes');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Medium');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).tier), 2, 'Saved unfinished store is at Medium');
    const resumedStats = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats);
    await page.reload();
    assert.equal(await page.rows(), 0, 'Unfinished reload starts a fresh board');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Medium', 'Unfinished reload stays at the same difficulty');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).tier), 2, 'Unfinished reload preserves stored tier');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), resumedStats, 'Unfinished reload keeps statistics');
    const target = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).rounds[1].target);
    await page.guess(target);
    const finishedStats = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats);
    await page.reload();
    assert.equal(await page.evaluate(() => document.querySelector('#journey-level-label').textContent), 'Hard', 'Finished round reload advances');
    assert.equal(await page.rows(), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')).stats), finishedStats, 'Finished reload counts the completed round once');
    checks.push({ check: 'legacy-migration-resume-and-reload' });
    await page.close();
  }

  for (const width of [320, 390]) {
    const page = await openPage(width, 568);
    await page.fixture();
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await page.fill('Fran');
    assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.country-option.selected')).outlineWidth) >= 2));
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
      document.head.append(style);
    });
    await page.guess('France');
    visible(await page.geometry(['#guess-form', '.status-line']), 'Increased text spacing');
    checks.push({ check: 'forced-colors-and-text-spacing', width });
    await page.close();
  }

  {
    const page = await openPage(390, 844);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.gameTools = {};
      Object.defineProperty(document, 'modelContext', { value: {
        registerTool(tool) { window.gameTools[tool.name] = tool; },
        unregisterTool() {}
      } });
    ` });
    await page.fixture();
    const completed = [], shown = [];
    for (let index = 0; index < 16; index++) {
      const state = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')));
      const current = state.rounds[state.tier - 1];
      assert.ok(!completed.slice(-12).includes(current.target), 'Answer cooldown survives journey resets');
      const hint = await page.reviewedHint();
      const recent = shown.slice(-6);
      if (recent.includes(hint.text)) {
        assert.ok(hint.runtimeEligible.every(item => recent.includes(item.text)));
        assert.equal(recent.lastIndexOf(hint.text), Math.min(...hint.runtimeEligible.map(item => recent.lastIndexOf(item.text))));
      }
      shown.push(hint.text);
      assert.equal(state.recentHints.length, Math.min(index + 1, 6));
      const board = await page.evaluate(() => window.gameTools.get_landle_board.execute());
      const pool = await page.evaluate(async () => {
        const { countriesForRound } = await import('./geography.js');
        const saved = JSON.parse(localStorage.getItem('landle-v1'));
        const active = saved.rounds[saved.tier - 1];
        return countriesForRound(active.tier, active.excludedCodes).map(item => item.name);
      });
      assert.equal(board.targetPoolSize, pool.length, 'Browser tools use the actual available answer pool');
      if (index === 13) {
        await page.click('#help-button');
        const names = await page.evaluate(() => Array.from(document.querySelectorAll('.pool-list span'), item => item.textContent));
        assert.deepEqual(names, pool, 'Help lists the exact answer pool after cooldowns');
        await page.click('.dialog-close');
        await page.navigate();
        assert.equal((await page.reviewedHint()).text, hint.text, 'Normal visits preserve the selected hint');
      }
      await page.guess(current.target);
      completed.push(current.target);
      const finished = await page.evaluate(() => JSON.parse(localStorage.getItem('landle-v1')));
      assert.deepEqual(finished.recentAnswers.map(entry => entry.code), completed.slice(-12));
      await page.click('#next-button');
    }
    checks.push({ check: 'answer-and-hint-cooldowns-across-journeys', rounds: completed.length });
    await page.close();
  }

  const exported = await openPage(390, 844, undefined, '/dist/index.html');
  await exported.reviewedHint();
  await exported.guess('Italy');
  assert.equal(await exported.rows(), 1, 'Static export accepts guesses');
  await exported.click('#help-button');
  assert.ok(await exported.evaluate(() => document.querySelector('#dialog-content').textContent.includes('2024')), 'Help retains data year');
  assert.ok(await exported.evaluate(() => Boolean(document.querySelector('#dialog-content a[href="data-sources.html"]'))), 'Help includes data sources');
  assert.ok(await exported.evaluate(() => Boolean(document.querySelector('#dialog-content a[href="licence.html"]'))), 'Help includes database licence');
  await exported.close();
  checks.push({ check: 'static-export' });
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(new URL('browser-results.json', output), JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2) + '\n');
  console.log(`Passed ${checks.length} browser scenarios. Evidence: artifacts/audit/.`);
} finally {
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (browser?.pid && browser.exitCode === null) {
    const stopped = once(browser, 'exit');
    browser.kill();
    await Promise.race([stopped, pause(3000)]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
