import { COUNTRIES } from './data.js';
import { clueFor, countriesForRound, findCountry } from './geography.js';
import {
  restoreStore,
  getPuzzle,
  getOpeningHint,
  recordGuess,
  advanceJourney,
  restartPuzzle
} from './game-state.js';
import { registerGameTools } from './game-tools.js';
import { searchCountries } from './country-search.js';

// Cache permanent elements; result and dialog content are replaced when rendered.
const ui = {
  helpButton: document.getElementById('help-button'),
  journeyLevelLabel: document.getElementById('journey-level-label'),
  journeyLevelProgress: document.getElementById('journey-level-progress'),
  openingHint: document.getElementById('opening-hint'),
  guessBoard: document.getElementById('guess-board'),
  guessForm: document.getElementById('guess-form'),
  countrySearch: document.getElementById('country-search'),
  countryOptions: document.getElementById('country-options'),
  clueAnnouncement: document.getElementById('clue-announcement'),
  gameMessage: document.getElementById('game-message'),
  guessCount: document.getElementById('guess-count'),
  resultPanel: document.getElementById('result-panel'),
  gameDialog: document.getElementById('game-dialog'),
  dialogBody: document.getElementById('dialog-body'),
  dialogContent: document.getElementById('dialog-content'),
  searchWrap: document.querySelector('.search-wrap'),
  statusLine: document.querySelector('.status-line'),
  dialogClose: document.querySelector('.dialog-close'),
};
const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'landle-v1';
const LEVELS = [null, 'Easy', 'Medium', 'Hard'];

let saved;
try {
  saved = localStorage.getItem(STORAGE_KEY);
} catch {}
let store = restoreStore(saved);
let lastStorageSnapshot = saved;
let current,
  options = [],
  activeOption = 0,
  lastRow = -1;
const countryByCode = new Map(COUNTRIES.map(country => [country.code, country]));
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function persist() {
  try {
    const snapshot = JSON.stringify(store);
    if (snapshot === lastStorageSnapshot) return;
    localStorage.setItem(STORAGE_KEY, snapshot);
    lastStorageSnapshot = snapshot;
  } catch {
    // Private browsing or a full storage quota must not interrupt play.
  }
}

// Refresh before each action as well as on storage events so a stale tab cannot
// overwrite a more recent board or completed game from another tab.
function refreshStore() {
  let snapshot;
  try {
    snapshot = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (snapshot === lastStorageSnapshot) return false;
  const previous = current;
  const previousIdentity = puzzleIdentity(previous);
  store = restoreStore(snapshot);
  current = getPuzzle(store);
  const replaced = previousIdentity !== puzzleIdentity(current);
  if (replaced) ui.countrySearch.value = '';
  lastStorageSnapshot = snapshot;
  persist();
  lastRow = -1;
  closeOptions();
  render();
  if (replaced) {
    message('The round changed in another tab. Start a new guess.');
  } else if (previous && previous.guesses.join(',') !== current.guesses.join(',')) {
    message('Progress updated from another tab. Your typed country is unchanged.');
  }
  return replaced;
}

function puzzleIdentity(puzzle) {
  return puzzle ? `${puzzle.tier}:${puzzle.target}:${puzzle.roundId}` : '';
}

function loadPuzzle() {
  current = getPuzzle(store);
  lastRow = -1;
  ui.countrySearch.value = '';
  ui.clueAnnouncement.textContent = '';
  closeOptions();
  persist();
  render();
}

function render() {
  ui.journeyLevelLabel.textContent = LEVELS[store.tier];
  ui.journeyLevelProgress.textContent = `Round ${store.tier} of 3`;
  const target = countryByCode.get(current.target);
  ui.openingHint.textContent = getOpeningHint(current);
  renderBoard(target);
  ui.guessCount.textContent = `${current.guesses.length} / 6 guesses`;
  ui.guessForm.hidden = current.finished;
  message(defaultMessage(), false, false);
  renderResult();
}

// Each row has one complete spoken description; visual tiles are decorative.
function renderBoard(target) {
  const board = ui.guessBoard;
  const rows = document.createDocumentFragment();
  for (let index = 0; index < 6; index++) {
    const guess = countryByCode.get(current.guesses[index]);
    const clue = guess ? clueFor(guess, target) : null;
    const row = document.createElement('div');
    row.className = `guess-row${guess?' filled':''}${clue?.correct?' correct':''}${index===current.guesses.length&&!current.finished?' current':''}${index===lastRow?' newly-filled':''}`;
    row.setAttribute('role', 'group');
    if (guess) {
      const description = describeClue(guess, clue);
      row.setAttribute('aria-label', `Guess ${index + 1}: ${description}`);
    } else row.setAttribute('aria-label', `Guess ${index+1}: ${index===current.guesses.length&&!current.finished?'next guess':'empty'}`);
    row.innerHTML = `<div class="country-tile" aria-hidden="true"><span class="row-number">${String(index+1).padStart(2,'0')}</span><span class="country-name">${guess?escapeHtml(guess.name):''}</span></div>`;
    const cells = guess ? [{
      symbol: clue.correct ? '✓' : clue.direction,
      label: clue.correct ? 'found' : clue.distance,
      style: clue.correct ? '' : `distance-${clue.distance.replaceAll(' ', '-')}`
    }, {
      symbol: clue.correct ? '✓' : comparisonSymbol(clue.population),
      label: clue.correct ? 'match' : ({
        up: 'more',
        down: 'fewer',
        equal: 'same'
      })[clue.population]
    }, {
      symbol: clue.correct ? '✓' : comparisonSymbol(clue.area),
      label: clue.correct ? 'match' : ({
        up: 'larger',
        down: 'smaller',
        equal: 'same'
      })[clue.area]
    }] : [null, null, null];
    for (const cell of cells) {
      const tile = document.createElement('div');
      tile.className = `clue-tile ${cell?.style||''}`;
      tile.setAttribute('aria-hidden', 'true');
      tile.innerHTML = cell ? `<span class="clue-symbol">${cell.symbol}</span><span class="clue-label">${cell.label}</span>` : '<span class="empty-mark"></span>';
      row.append(tile);
    }
    rows.append(row);
  }
  board.replaceChildren(rows);
}

function describeClue(country, clue) {
  if (clue.correct) return `${country.name} is correct.`;
  const population = { up: 'more', down: 'fewer', equal: 'the same number of' }[clue.population];
  const area = { up: 'a larger', down: 'a smaller', equal: 'the same' }[clue.area];
  return `${country.name}: the hidden country is ${clue.directionName}, ${clue.distance}. It has ${population} people and ${area} land area.`;
}

function comparisonSymbol(value) {
  return {
    up: '↑',
    down: '↓',
    equal: '='
  }[value] || '=';
}

function defaultMessage() {
  if (current.finished) return '';
  const remaining = 6 - current.guesses.length;
  return current.guesses.length ? `${remaining} ${remaining === 1 ? 'guess' : 'guesses'} left.` : '';
}

function message(text, error = false, announce = true) {
  ui.gameMessage.textContent = text;
  ui.gameMessage.classList.toggle('error', error);
  ui.countrySearch.setAttribute('aria-invalid', String(error));
  if (announce) ui.clueAnnouncement.textContent = text;
}

function closeOptions() {
  ui.countryOptions.hidden = true;
  ui.countrySearch.setAttribute('aria-expanded', 'false');
  ui.countrySearch.removeAttribute('aria-activedescendant');
  ui.countryOptions.classList.remove('above');
  ui.countryOptions.style.removeProperty('--options-max-height');
  options = [];
  activeOption = 0;
}

function updateOptions() {
  const input = ui.countrySearch;
  if (current.finished || !input.value.trim()) return closeOptions();
  options = searchCountries(input.value);
  activeOption = 0;
  renderOptions();
}

function renderOptions() {
  const list = ui.countryOptions;
  list.innerHTML = '';
  list.hidden = false;
  ui.countrySearch.setAttribute('aria-expanded', 'true');
  if (!options.length) {
    const empty = document.createElement('div');
    empty.className = 'no-options';
    empty.textContent = 'No country found. Try another name.';
    list.append(empty);
    ui.countrySearch.removeAttribute('aria-activedescendant');
    positionOptions();
    return;
  }
  options.forEach((country, index) => {
    const used = current.guesses.includes(country.code);
    const option = document.createElement('div');
    option.id = `country-option-${index}`;
    option.role = 'option';
    option.setAttribute('aria-selected', String(index === activeOption));
    option.className = `country-option${index===activeOption?' selected':''}${used?' used':''}`;
    option.innerHTML = `<span>${escapeHtml(country.name)}</span>${used?'<span class="option-meta">guessed</span>':''}`;
    // Keep desktop input focus, but let touch users scroll the suggestion list.
    option.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') event.preventDefault();
    });
    option.addEventListener('click', () => chooseOption(index));
    list.append(option);
  });
  positionOptions();
  highlightOption();
}

function highlightOption() {
  const list = ui.countryOptions;
  [...list.children].forEach((option, index) => {
    option.classList.toggle('selected', index === activeOption);
    option.setAttribute('aria-selected', String(index === activeOption));
  });
  ui.countrySearch.setAttribute('aria-activedescendant', `country-option-${activeOption}`);
  const selected = list.children[activeOption];
  if (!selected) return;
  const top = selected.offsetTop;
  const bottom = top + selected.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function viewportBounds() {
  const view = window.visualViewport;
  return { top: (view?.offsetTop || 0) + 12, bottom: (view?.offsetTop || 0) + (view?.height || innerHeight) - 12 };
}

function positionOptions() {
  const list = ui.countryOptions;
  if (list.hidden) return;
  const rect = ui.searchWrap.getBoundingClientRect();
  const view = viewportBounds();
  const above = Math.max(0, rect.top - view.top - 5);
  const below = Math.max(0, view.bottom - rect.bottom - 5);
  const desired = Math.min(252, list.scrollHeight + 2);
  const useAbove = below < desired && above > below;
  list.classList.toggle('above', useAbove);
  list.style.setProperty('--options-max-height', `${Math.floor(Math.min(252, useAbove ? above : below))}px`);
}

function revealWorkingArea() {
  requestAnimationFrame(() => {
    const view = viewportBounds();
    let elements;
    if (current.finished) elements = [ui.resultPanel];
    else {
      const latest = [...document.querySelectorAll('#guess-board .filled')].at(-1);
      elements = [latest, ui.guessForm, ui.statusLine].filter(Boolean);
    }
    const bounds = list => {
      const rects = list.map(element => element.getBoundingClientRect());
      return { top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
    };
    let rect = bounds(elements);
    if (rect.bottom - rect.top > view.bottom - view.top) {
      rect = bounds(current.finished ? [$('#next-button')] : [ui.guessForm, ui.statusLine]);
    }
    if (rect.bottom - rect.top > view.bottom - view.top) rect = bounds([current.finished ? $('#next-button') : ui.countrySearch]);
    const delta = rect.top < view.top ? rect.top - view.top : rect.bottom > view.bottom ? rect.bottom - view.bottom : 0;
    if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
    positionOptions();
  });
}

function chooseOption(index) {
  const country = options[index];
  if (!country) return;
  ui.countrySearch.value = country.name;
  ui.countrySearch.focus({ preventScroll: true });
  closeOptions();
  message(`${country.name} selected. Press Guess or Enter.`);
  revealWorkingArea();
}

function submitGuess(event) {
  event.preventDefault();
  if (refreshStore()) return;
  if (current.finished) return;
  const value = ui.countrySearch.value.trim();
  const country = findCountry(value);
  if (!country) {
    message(!value ? 'Type a country to make a guess.' : searchCountries(value).length ? 'Choose a matching country from the suggestions.' : 'No country matches that name. Try another name or country code.', true);
    ui.countrySearch.focus({ preventScroll: true });
    if (matchMedia('(max-width: 640px)').matches && !searchCountries(value).length) closeOptions();
    else updateOptions();
    revealWorkingArea();
    return;
  }
  if (current.guesses.includes(country.code)) {
    message(`You already tried ${country.name}. Choose another country.`, true);
    closeOptions();
    ui.countrySearch.focus({ preventScroll: true });
    revealWorkingArea();
    return;
  }
  const result = recordGuess(store, current, country.code);
  if (!result.ok) {
    message('This puzzle needs a fresh start. Please reload.', true);
    return;
  }
  lastRow = current.guesses.length - 1;
  ui.countrySearch.value = '';
  closeOptions();
  persist();
  render();
  const clue = result.clue;
  const remaining = 6 - current.guesses.length;
  const ending = clue.correct ? `Found in ${current.guesses.length} ${current.guesses.length === 1 ? 'guess' : 'guesses'}.` : current.finished ? `The hidden country was ${countryByCode.get(current.target).name}.` : `${remaining} ${remaining === 1 ? 'guess' : 'guesses'} left.`;
  const announcement = `${describeClue(country, clue)} ${ending}`;
  ui.clueAnnouncement.textContent = announcement;
  if (!current.finished) ui.countrySearch.focus({ preventScroll: true });
  else $('#next-button')?.focus({
    preventScroll: true
  });
  revealWorkingArea();
}

function renderResult() {
  const panel = ui.resultPanel;
  panel.hidden = !current.finished;
  if (!current.finished) {
    panel.innerHTML = '';
    return;
  }
  const target = countryByCode.get(current.target);
  const journeyFinished = store.tier === 3;
  const text = current.won ? `Found in ${current.guesses.length} ${current.guesses.length === 1 ? 'guess' : 'guesses'}.` : 'Six guesses used.';
  panel.innerHTML = `
    <span class="result-eyebrow">${current.won ? 'COUNTRY FOUND' : 'COUNTRY REVEALED'}</span>
    <h2>${escapeHtml(target.name)}</h2>
    <p>${text}</p>
    <div class="result-facts">
      <span>${escapeHtml(target.region)}</span>
      <span>${formatNumber(target.population)} people</span>
      <span>${formatNumber(target.area)} km² land</span>
    </div>
    <p class="promotion-note">${journeyFinished ? 'Journey complete. Ready for another?' : `Next round: <strong>${LEVELS[store.tier + 1]}</strong>.`}</p>
    <div class="result-actions">
      <button class="primary-button" id="next-button">${journeyFinished ? 'Start a new journey' : 'Start a new round'}<span aria-hidden="true">↗</span></button>
    </div>`;
  $('#next-button').addEventListener('click', nextPuzzle);
}

const wholeNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const smallNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
function formatNumber(value) {
  return (value > 0 && value < 10 ? smallNumber : wholeNumber).format(value);
}

function nextPuzzle() {
  if (refreshStore()) return;
  if (!current.finished) return;
  advanceJourney(store, current);
  loadPuzzle();
  ui.clueAnnouncement.textContent = `New round: ${LEVELS[store.tier]}.`;
  revealNewRound();
}

function usesResponsiveTouchLayout() {
  return matchMedia('(pointer: coarse) and (max-width: 1199px)').matches;
}

// A short screen shows the new hint first; entry remains in the ordinary board.
function revealNewRound() {
  if (!usesResponsiveTouchLayout()) {
    ui.countrySearch.focus({ preventScroll: true });
    revealWorkingArea();
    return;
  }
  // Let touch players read the new difficulty and hint before opening a keyboard.
  ui.openingHint.closest('.opening-hint').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setupPoolFilter() {
  const input = ui.dialogContent.querySelector('#pool-search');
  if (!input) return;
  const entries = [...ui.dialogContent.querySelectorAll('.pool-list [data-code]')];
  const count = ui.dialogContent.querySelector('#pool-filter-count');
  const empty = ui.dialogContent.querySelector('#pool-filter-empty');
  const revealFilter = () => {
    if (!phoneHelpLayout.matches) return;
    const section = input.closest('.pool-details');
    ui.dialogBody.scrollTop += section.getBoundingClientRect().top - ui.dialogBody.getBoundingClientRect().top - 12;
  };
  input.addEventListener('focus', revealFilter);
  input.addEventListener('input', () => {
    const query = input.value.trim();
    const matches = new Set(query ? searchCountries(query, COUNTRIES.length).map(country => country.code) : []);
    let shown = 0;
    for (const entry of entries) {
      entry.hidden = Boolean(query) && !matches.has(entry.dataset.code);
      if (!entry.hidden) shown++;
    }
    count.textContent = query ? `${shown} of ${entries.length} possible countries` : `All ${entries.length} possible countries`;
    empty.hidden = shown > 0;
    requestAnimationFrame(revealFilter);
  });
}

// Returning to the existing wider Help layout must also restore its full list.
const phoneHelpLayout = matchMedia('(max-width: 640px)');
phoneHelpLayout.addEventListener('change', ({ matches }) => {
  if (matches) return;
  const input = ui.dialogContent.querySelector('#pool-search');
  if (input?.value) {
    input.value = '';
    input.dispatchEvent(new Event('input'));
  }
});

function showDialog(content) {
  closeOptions();
  ui.dialogContent.innerHTML = content;
  const title = ui.dialogContent.querySelector('h2');
  if (title) title.id = 'dialog-title';
  ui.dialogBody.scrollTop = 0;
  ui.gameDialog.showModal();
  setupPoolFilter();
}

function showHelp() {
  showDialog(`<h2>How to play</h2>
    <p>Find the hidden country in six guesses. Type a country name and press <strong>Guess</strong>. Use the suggestions if you need help choosing a match.</p>
    <h3>Read the clues</h3>
    <p>Every clue describes the answer compared with your guess.</p>
    <div class="help-example">
      <p>If you guess <strong>France</strong> and the answer is <strong>Germany</strong>:</p>
      <p><strong>↗ close</strong> — northeast of France<br>
      <strong>↑ more</strong> — more people than France<br>
      <strong>↓ smaller</strong> — less land than France</p>
    </div>
    <p>Each journey has three rounds: <strong>Easy → Medium → Hard</strong>, with six guesses per country. Finish a round to move on, whether you find the country or use all six guesses. After Hard, start a new journey at Easy.</p>
    <p>Reload starts a fresh country at the current difficulty. If the round is already finished, it moves to the next round. Your statistics stay.</p>
    ${poolDetails()}
    <details class="pool-details help-reference">
      <summary>Typing, clues and saved progress</summary>
      <h3>Typing and Enter</h3>
      <p>When a country is highlighted in the suggestions, <strong>Enter</strong> selects it. Press Enter again to guess. An exact supported name, alias or country code can also be submitted directly with Guess. Ambiguous names such as Congo or Korea need a suggestion to choose the intended country.</p>
      <h3>Clue details</h3>
      <p>A “same” clue means the population or land-area figures match; it does not mean you have found the country. Direction and distance use one approximate point per country. The arrow follows the start of the shortest route around the globe, which can differ from a line on a flat map. The starting hint gives one reviewed fact about the country’s name, geography, population or land area, and stays the same throughout the round.</p>
      <p>Name hints use the displayed English country name in the suggestions. Accents count as ordinary letters; spaces and hyphens do not count as letters. Vowels are A, E, I, O and U.</p>
      <p>Very close: under 500 km<br>Close: 500 to under 2,000 km<br>Nearby: 2,000 to under 5,000 km<br>Far: 5,000 to under 10,000 km<br>Very far: 10,000 km or more</p>
      <h3>Levels and saved progress</h3>
      <p>Easy starts with 45 possible answers. Medium expands the pool to 110. Hard includes all 195 countries in this game. The last 12 finished answers are excluded across journeys. Starting hints avoid wording from the last six rounds when an eligible alternative is available. You can guess any of the 195 countries in every round.</p>
      <p>Opening the game normally resumes your saved round. Only finished rounds count toward statistics; abandoning an unfinished round adds no loss. Progress and statistics are saved in this browser.</p>
      <p class="dialog-footnote">Population uses fixed 2024 figures, and land area uses World Bank 2023 data. Vatican City uses its official 2024 resident count and official land area.<br>
      <a class="help-source-link" href="data-sources.html" target="_blank" rel="noopener">Data sources and attribution (opens in a new tab)</a><br>
      <a class="help-source-link" href="licence.html" target="_blank" rel="noopener">Database licence (opens in a new tab)</a></p>
    </details>`);
}

function poolDetails() {
  const pool = availableRoundCountries();
  const filter = pool.length > 45 ? `<div class="pool-filter">
    <label for="pool-search">Filter possible countries</label>
    <input id="pool-search" type="search" placeholder="Country name or code…" autocomplete="off" spellcheck="false" aria-controls="possible-country-list">
    <p id="pool-filter-count" role="status" aria-live="polite">All ${pool.length} possible countries</p>
  </div>` : '';
  return `<details class="pool-details"><summary>Possible ${LEVELS[store.tier]} countries (${pool.length})</summary>${filter}<div id="possible-country-list" class="pool-list">${pool.map(country => `<span data-code="${country.code}">${escapeHtml(country.name)}</span>`).join('')}</div><p id="pool-filter-empty" hidden>No matching possible countries.</p></details>`;
}

function availableRoundCountries() {
  return countriesForRound(current.tier, current.excludedCodes);
}

ui.guessForm.addEventListener('submit', submitGuess);
ui.countrySearch.addEventListener('input', () => {
  message(defaultMessage(), false, false);
  updateOptions();
});
ui.countrySearch.addEventListener('focus', () => {
  if (ui.countrySearch.value && !current.finished) updateOptions();
});
ui.countrySearch.addEventListener('keydown', event => {
  // Enter confirms a character while an international keyboard is composing.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeOptions();
    return;
  }
  if (ui.countryOptions.hidden) {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && ui.countrySearch.value.trim()) {
      event.preventDefault();
      updateOptions();
      if (event.key === 'ArrowUp' && options.length) {
        activeOption = options.length - 1;
        highlightOption();
      }
    }
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!options.length) return;
    activeOption = (activeOption + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    highlightOption();
  } else if (event.key === 'Enter' && options.length) {
    event.preventDefault();
    chooseOption(activeOption);
  } else if (event.key === 'Tab') closeOptions();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.search-wrap')) closeOptions();
});
window.addEventListener('scroll', positionOptions, { passive: true });
let previousLayoutWidth = innerWidth;
let previousLayoutHeight = innerHeight;
function handleViewportResize() {
  positionOptions();
  const rotatedToShortLandscape = usesResponsiveTouchLayout() && innerWidth > previousLayoutWidth && innerHeight < previousLayoutHeight && innerHeight <= 500 && innerWidth > innerHeight;
  previousLayoutWidth = innerWidth;
  previousLayoutHeight = innerHeight;
  if (document.activeElement !== ui.countrySearch || current.finished) return;
  if (rotatedToShortLandscape) {
    closeOptions();
    const latest = [...ui.guessBoard.querySelectorAll('.filled')].at(-1);
    const context = latest || ui.openingHint.closest('.opening-hint');
    context.tabIndex = -1;
    context.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const view = viewportBounds();
      const hint = ui.openingHint.getBoundingClientRect();
      const clue = context.getBoundingClientRect();
      const top = clue.bottom - hint.top <= view.bottom - view.top ? hint.top : clue.top;
      window.scrollBy({ top: top - view.top, behavior: 'instant' });
    });
    return;
  }
  revealWorkingArea();
}
window.addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('scroll', positionOptions);
ui.helpButton.addEventListener('click', showHelp);
ui.dialogClose.addEventListener('click', () => ui.gameDialog.close());
ui.gameDialog.addEventListener('click', event => {
  if (event.target === ui.gameDialog) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  }
});
// Receive saved-board changes from other tabs, including cleared browser storage.
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) refreshStore();
});

// Reload refreshes an unfinished round or advances a finished one; a normal visit resumes it.
const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
if (isReload) restartPuzzle(store);
loadPuzzle();

// Optional structured browser access reveals only what a player can already see.
function getBoard() {
  const target = countryByCode.get(current.target);
  return {
    round: store.tier,
    totalRounds: 3,
    level: LEVELS[store.tier],
    targetPoolSize: availableRoundCountries().length,
    openingHint: getOpeningHint(current),
    attemptsRemaining: 6 - current.guesses.length,
    finished: current.finished,
    won: current.won,
    guesses: current.guesses.map(code => {
      const guess = countryByCode.get(code);
      const clue = clueFor(guess, target);
      return {
        country: guess.name,
        correct: clue.correct,
        direction: clue.direction,
        distance: clue.distance,
        population: clue.population,
        landArea: clue.area
      };
    }),
    ...(current.finished ? {
      answer: target.name
    } : {})
  };
}

registerGameTools({
  getBoard,
  guessCountry(name) {
    if (refreshStore()) return {
      error: 'The round changed. Read the new board before guessing.',
      board: getBoard()
    };
    if (current.finished) return {
      error: 'This round is finished.',
      board: getBoard()
    };
    const country = findCountry(name);
    if (!country) return {
      error: 'Unknown or ambiguous country. Use a complete country name.',
      board: getBoard()
    };
    if (current.guesses.includes(country.code)) return {
      error: 'That country has already been guessed.',
      board: getBoard()
    };
    const count = current.guesses.length;
    ui.countrySearch.value = country.name;
    submitGuess({
      preventDefault() {}
    });
    return current.guesses.length > count ? {
      board: getBoard()
    } : {
      error: ui.gameMessage.textContent,
      board: getBoard()
    };
  },
  nextCountry() {
    if (refreshStore()) return {
      error: 'The round changed. Read the new board before continuing.',
      board: getBoard()
    };
    if (!current.finished) return {
      error: 'Finish the current round first.',
      board: getBoard()
    };
    nextPuzzle();
    return {
      board: getBoard()
    };
  }
});
