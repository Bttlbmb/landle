import { COUNTRIES } from './data.js';
import { clueFor, countriesForRound, chooseOpeningHint, openingHintsFor } from './geography.js';
import { STARTING_HINTS } from './starting-hints.js';

const COUNTRY_BY_CODE = new Map(COUNTRIES.map(country => [country.code, country]));
const TIERS = [1, 2, 3];
export const MAX_GUESSES = 6;
const ANSWER_COOLDOWN = 12;
const HINT_COOLDOWN = 6;
// Twelve completed answers, up to two earlier rounds, and the board being reloaded.
const MAX_EXCLUSIONS = ANSWER_COOLDOWN + 3;
const HINT_IDS = new Set(Object.values(STARTING_HINTS).flat().map(hint => hint.id));
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const increment = value => Math.min(Number.MAX_SAFE_INTEGER, counter(value) + 1);
const validRoundId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
let roundSequence = 0;

export function newStore() {
  return {
    version: 2, tier: 1, rounds: [], recentAnswers: [], recentHints: [],
    stats: { played: 0, won: 0, streak: 0, best: 0, distribution: Array(MAX_GUESSES).fill(0) },
  };
}

function randomNumber() {
  const random = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(random);
  else random[0] = Math.random() * 2 ** 32;
  return random[0];
}

function newRoundId() {
  if (globalThis.crypto?.randomUUID) return `round-${globalThis.crypto.randomUUID()}`;
  return `round-${Date.now().toString(36)}-${(++roundSequence).toString(36)}-${randomNumber().toString(36)}`;
}

/** Optional random is an unsigned 32-bit integer for reproducible target selection. */
export function createPuzzle(tier, { previousCode, excludedCodes = [], recentHintIds = [], random } = {}) {
  if (!TIERS.includes(tier)) throw new RangeError('Tier must be 1, 2, or 3.');
  if (!Array.isArray(excludedCodes)) throw new RangeError('Excluded codes must be an array.');
  const exclusions = [...new Set([...excludedCodes, ...(previousCode === undefined ? [] : [previousCode])])];
  if (exclusions.length > MAX_EXCLUSIONS || exclusions.some(code => !COUNTRY_BY_CODE.has(code))) {
    throw new RangeError('At most fifteen known previous answers can be excluded.');
  }
  const pool = countriesForRound(tier, exclusions);
  if (!pool.length) throw new RangeError('At least one country must remain available.');
  const number = random === undefined ? randomNumber() : random;
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) throw new RangeError('Random must be an unsigned 32-bit integer.');
  const target = pool[number % pool.length];
  const roundId = newRoundId();
  const hintId = chooseOpeningHint(target, roundId, tier, exclusions, recentHintIds).id;
  return { target: target.code, guesses: [], finished: false, won: false, counted: false,
    roundId, tier, excludedCodes: Object.freeze(exclusions), hintId };
}

function validExclusions(puzzle, allowLegacy = false) {
  if (allowLegacy && puzzle.excludedCodes === undefined) return true;
  const exclusions = puzzle.excludedCodes;
  return Array.isArray(exclusions) && exclusions.length <= MAX_EXCLUSIONS
    && new Set(exclusions).size === exclusions.length
    && Array.from(exclusions).every(code => COUNTRY_BY_CODE.has(code) && code !== puzzle.target);
}

function historyValid(puzzle, { tier } = {}) {
  if (!isRecord(puzzle) || !TIERS.includes(puzzle.tier)) return false;
  if (tier !== undefined && puzzle.tier !== tier) return false;
  const target = COUNTRY_BY_CODE.get(puzzle.target);
  if (!target || target.tier > puzzle.tier || !Array.isArray(puzzle.guesses) || puzzle.guesses.length > MAX_GUESSES) return false;
  if (!validExclusions(puzzle, true)) return false;
  if (new Set(puzzle.guesses).size !== puzzle.guesses.length || !Array.from(puzzle.guesses).every(code => COUNTRY_BY_CODE.has(code))) return false;
  const targetIndex = puzzle.guesses.indexOf(puzzle.target);
  return targetIndex === -1 || targetIndex === puzzle.guesses.length - 1;
}

function outcome(puzzle) {
  const won = puzzle.guesses.at(-1) === puzzle.target;
  return { won, finished: won || puzzle.guesses.length === MAX_GUESSES };
}

export function validPuzzle(puzzle, options = {}) {
  if (!historyValid(puzzle, options) || !validExclusions(puzzle) || !validRoundId(puzzle.roundId)) return false;
  const target = COUNTRY_BY_CODE.get(puzzle.target);
  try {
    if (!countriesForRound(puzzle.tier, puzzle.excludedCodes).includes(target)
      || !openingHintsFor(target, puzzle.tier, puzzle.excludedCodes).some(hint => hint.id === puzzle.hintId)) return false;
  } catch { return false; }
  const { won, finished } = outcome(puzzle);
  return puzzle.won === won && puzzle.finished === finished && puzzle.counted === finished;
}

function restorePuzzle(value, tier, earlierTargets) {
  if (!historyValid(value, { tier }) || !validRoundId(value.roundId)) return null;
  const { won, finished } = outcome(value);
  // Saved completed history cannot be replayed into lifetime statistics.
  const exclusions = [...new Set([...(value.excludedCodes || []), ...earlierTargets])];
  if (exclusions.length > MAX_EXCLUSIONS || exclusions.includes(value.target)) return null;
  const target = COUNTRY_BY_CODE.get(value.target);
  let hintId;
  try {
    if (!countriesForRound(tier, exclusions).includes(target)) return null;
    const hints = openingHintsFor(target, tier, exclusions);
    // Keep the saved hint; legacy boards retain their original seeded choice when still fair.
    hintId = hints.find(hint => hint.id === value.hintId)?.id
      || chooseOpeningHint(target, value.roundId, tier, exclusions).id;
  } catch { return null; }
  return { target: value.target, guesses: [...value.guesses], won, finished, counted: finished,
    roundId: value.roundId, tier, excludedCodes: Object.freeze(exclusions), hintId };
}

/** Read the persisted choice, never select a new hint while rendering. */
export function getOpeningHint(puzzle) {
  const hint = STARTING_HINTS[puzzle?.target]?.find(item => item.id === puzzle.hintId);
  if (!hint) throw new RangeError('The puzzle needs a reviewed starting hint.');
  return hint.text;
}

function restoreRecent(value, field, limit, valid) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const entries = [];
  // Keep the latest entry if damaged storage repeats a round identity.
  for (let index = value.length - 1; index >= 0; index--) {
    const entry = value[index];
    if (!isRecord(entry) || !validRoundId(entry.roundId) || !valid(entry[field]) || seen.has(entry.roundId)) continue;
    seen.add(entry.roundId);
    entries.push({ roundId: entry.roundId, [field]: entry[field] });
    if (entries.length === limit) break;
  }
  return entries.reverse();
}

function ensureRecent(store) {
  store.recentAnswers = restoreRecent(store.recentAnswers, 'code', ANSWER_COOLDOWN, code => COUNTRY_BY_CODE.has(code));
  store.recentHints = restoreRecent(store.recentHints, 'hintId', HINT_COOLDOWN, id => HINT_IDS.has(id));
}

function remember(store, field, entry, limit) {
  if (!store[field].some(previous => previous.roundId === entry.roundId)) {
    store[field].push(entry);
    store[field] = store[field].slice(-limit);
  }
}

function rememberHint(store, puzzle) {
  remember(store, 'recentHints', { roundId: puzzle.roundId, hintId: puzzle.hintId }, HINT_COOLDOWN);
}

function rememberAnswer(store, puzzle) {
  remember(store, 'recentAnswers', { roundId: puzzle.roundId, code: puzzle.target }, ANSWER_COOLDOWN);
}

function nextPuzzle(store, tier, extraCodes = [], random) {
  const excludedCodes = [...new Set([...store.recentAnswers.map(entry => entry.code), ...extraCodes])];
  return createPuzzle(tier, { excludedCodes, recentHintIds: store.recentHints.map(entry => entry.hintId), random });
}

function restoreStats(value) {
  const stats = newStore().stats;
  if (!isRecord(value)) return stats;
  stats.played = counter(value.played);
  stats.won = Math.min(counter(value.won), stats.played);
  stats.streak = Math.min(counter(value.streak), stats.won);
  stats.best = Math.max(stats.streak, Math.min(counter(value.best), stats.won));
  let remainingWins = stats.won;
  for (let index = 0; index < MAX_GUESSES; index++) {
    const count = Math.min(counter(Array.isArray(value.distribution) ? value.distribution[index] : 0), remainingWins);
    stats.distribution[index] = count;
    remainingWins -= count;
  }
  return stats;
}

/** Recover history in order; an unfinished or corrupt prefix cannot skip a round. */
export function restoreStore(raw) {
  const store = newStore();
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return store; }
  }
  if (!isRecord(raw) || ![1, 2].includes(raw.version)) return store;
  store.stats = restoreStats(raw.stats);
  // The old progression does not describe a three-round journey.
  if (raw.version === 1 || !Array.isArray(raw.rounds)) return store;
  store.recentAnswers = restoreRecent(raw.recentAnswers, 'code', ANSWER_COOLDOWN, code => COUNTRY_BY_CODE.has(code));
  store.recentHints = restoreRecent(raw.recentHints, 'hintId', HINT_COOLDOWN, id => HINT_IDS.has(id));
  const migrateHints = store.recentHints.length === 0;
  const requestedTier = TIERS.includes(raw.tier) ? raw.tier : 1;
  const targets = new Set();
  const identities = new Set();
  for (let tier = 1; tier <= requestedTier; tier++) {
    store.tier = tier;
    const puzzle = restorePuzzle(raw.rounds[tier - 1], tier, [...targets]);
    if (!puzzle || targets.has(puzzle.target) || identities.has(puzzle.roundId)) break;
    store.rounds.push(puzzle);
    if (puzzle.finished) rememberAnswer(store, puzzle);
    if (migrateHints) rememberHint(store, puzzle);
    targets.add(puzzle.target);
    identities.add(puzzle.roundId);
    if (!puzzle.finished) break;
  }
  if (store.rounds.length) rememberHint(store, store.rounds.at(-1));
  return store;
}

function validPrefix(store) {
  if (!isRecord(store) || store.version !== 2 || !TIERS.includes(store.tier) || !Array.isArray(store.rounds) || store.rounds.length !== store.tier) return false;
  const targets = new Set();
  const identities = new Set();
  return Array.from(store.rounds).every((puzzle, index) => {
    if (!validPuzzle(puzzle, { tier: index + 1 }) || (index + 1 < store.tier && !puzzle.finished)
      || targets.has(puzzle.target) || identities.has(puzzle.roundId)
      || [...targets].some(code => !puzzle.excludedCodes.includes(code))) return false;
    targets.add(puzzle.target);
    identities.add(puzzle.roundId);
    return true;
  });
}

export function getPuzzle(store) {
  if (!isRecord(store) || store.version !== 2) throw new RangeError('A valid journey store is required.');
  ensureRecent(store);
  if (!TIERS.includes(store.tier)) store.tier = 1;
  if (!Array.isArray(store.rounds)) {
    store.rounds = [];
    store.tier = 1;
  }
  const targets = new Set();
  const identities = new Set();
  for (let tier = 1; tier <= store.tier; tier++) {
    const puzzle = store.rounds[tier - 1];
    const valid = validPuzzle(puzzle, { tier }) && !targets.has(puzzle.target) && !identities.has(puzzle.roundId)
      && [...targets].every(code => puzzle.excludedCodes.includes(code));
    if (!valid || (tier < store.tier && !puzzle.finished)) {
      store.tier = tier;
      store.rounds.length = tier - 1;
      store.rounds.push(valid ? puzzle : nextPuzzle(store, tier, [...targets]));
      break;
    }
    targets.add(puzzle.target);
    identities.add(puzzle.roundId);
  }
  store.rounds.length = store.tier;
  const current = store.rounds[store.tier - 1];
  rememberHint(store, current);
  return current;
}

function isActivePuzzle(store, puzzle) {
  // Object identity prevents an old or detached board from changing a newer round.
  return validPrefix(store) && puzzle === store.rounds[store.tier - 1];
}

/** Stable error codes let the UI choose friendly wording without consuming a guess. */
export function recordGuess(store, puzzle, code) {
  const failure = error => ({ ok: false, error, clue: null });
  if (!isActivePuzzle(store, puzzle)) return failure('invalid-puzzle');
  if (puzzle.finished) return failure('finished');
  const country = COUNTRY_BY_CODE.get(code);
  if (!country) return failure('unknown-country');
  if (puzzle.guesses.includes(code)) return failure('duplicate-country');
  ensureRecent(store);
  rememberHint(store, puzzle);
  const clue = clueFor(country, COUNTRY_BY_CODE.get(puzzle.target));
  puzzle.guesses.push(code);
  Object.assign(puzzle, outcome(puzzle));
  if (puzzle.finished && !puzzle.counted) {
    puzzle.counted = true;
    rememberAnswer(store, puzzle);
    store.stats.played = increment(store.stats.played);
    if (puzzle.won) {
      store.stats.won = increment(store.stats.won);
      store.stats.streak = increment(store.stats.streak);
      const index = puzzle.guesses.length - 1;
      store.stats.distribution[index] = increment(store.stats.distribution[index]);
    } else store.stats.streak = 0;
    store.stats.best = Math.max(store.stats.best, store.stats.streak);
  }
  return { ok: true, error: null, clue };
}

function startNextRound(store, puzzle, random) {
  if (!isActivePuzzle(store, puzzle) || !puzzle.finished) throw new RangeError('Finish the current puzzle before advancing.');
  const tier = store.tier === 3 ? 1 : store.tier + 1;
  ensureRecent(store);
  const next = nextPuzzle(store, tier, store.rounds.map(round => round.target), random);
  if (store.tier === 3) store.rounds = [];
  store.tier = tier;
  store.rounds.push(next);
  rememberHint(store, next);
  return next;
}

/** Both outcomes advance one round; after Hard, the next action begins at Easy. */
export function advanceJourney(store, puzzle, { random } = {}) {
  return startNextRound(store, puzzle, random);
}

/** Reload replaces an unfinished board; a completed board advances without replay. */
export function restartPuzzle(store, { random } = {}) {
  const previous = getPuzzle(store);
  if (previous.finished) return startNextRound(store, previous, random);
  const next = nextPuzzle(store, store.tier, store.rounds.map(round => round.target), random);
  store.rounds[store.tier - 1] = next;
  rememberHint(store, next);
  return next;
}
