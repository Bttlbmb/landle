import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES } from '../data.js';
import { countriesForTier, findCountry, openingHint, openingHintsFor } from '../geography.js';
import { newStore, restoreStore, createPuzzle, validPuzzle, getPuzzle, recordGuess, advanceJourney, restartPuzzle, getOpeningHint } from '../game-state.js';

const wrongCodes = puzzle => COUNTRIES.filter(country => country.code !== puzzle.target).slice(0, 6).map(country => country.code);
const setup = (tier = 1) => {
  const store = newStore();
  for (let currentTier = 1; currentTier <= tier; currentTier++) {
    store.tier = currentTier;
    const puzzle = createPuzzle(currentTier, { random: 0, excludedCodes: store.rounds.map(round => round.target) });
    store.rounds.push(puzzle);
    if (currentTier < tier) recordGuess(store, puzzle, puzzle.target);
  }
  return { store, puzzle: getPuzzle(store) };
};
const finish = (store, puzzle, won) => {
  if (won) assert.equal(recordGuess(store, puzzle, puzzle.target).ok, true);
  else for (const code of wrongCodes(puzzle)) assert.equal(recordGuess(store, puzzle, code).ok, true);
};

test('new stores are independent and broken or unsupported storage resets safely', () => {
  const first = newStore();
  first.stats.distribution[0] = 12;
  first.rounds.push(createPuzzle(1));
  assert.deepEqual(newStore(), { version: 2, tier: 1, rounds: [], recentAnswers: [], recentHints: [], stats: { played: 0, won: 0, streak: 0, best: 0, distribution: [0, 0, 0, 0, 0, 0] } });
  for (const raw of [undefined, null, '', '{', 'null', '[]', {}, { version: 3 }, { version: 2 }]) {
    assert.deepEqual(restoreStore(raw), newStore());
  }
});

test('target selection uses each difficulty pool and excludes previous countries', () => {
  for (const tier of [1, 2, 3]) {
    const first = createPuzzle(tier, { random: 0 });
    assert.equal(createPuzzle(tier, { random: 0 }).target, first.target);
    assert.ok(countriesForTier(tier).some(country => country.code === first.target));
    const second = createPuzzle(tier, { random: 0, previousCode: first.target });
    const third = createPuzzle(tier, { random: 0, excludedCodes: [first.target, second.target] });
    assert.notEqual(second.target, first.target);
    assert.notEqual(third.target, first.target);
    assert.notEqual(third.target, second.target);
    assert.equal(validPuzzle(first), true);
    assert.deepEqual(Object.keys(first).sort(), ['counted', 'excludedCodes', 'finished', 'guesses', 'hintId', 'roundId', 'target', 'tier', 'won']);
  }
  for (const tier of [0, 4, '1', null]) assert.throws(() => createPuzzle(tier), RangeError);
  for (const random of [-1, 2 ** 32, 1.5, '0', null, NaN]) assert.throws(() => createPuzzle(1, { random }), RangeError);
  assert.throws(() => createPuzzle(1, { excludedCodes: 'AR' }), RangeError);
  assert.throws(() => createPuzzle(1, { excludedCodes: ['ZZ'] }), RangeError);
  assert.throws(() => createPuzzle(1, { previousCode: 'ZZ' }), RangeError);
  assert.throws(() => createPuzzle(1, { excludedCodes: countriesForTier(1).map(country => country.code) }), RangeError);
});

test('round exclusions are saved, deduplicated, copied and immutable', () => {
  const excluded = ['GR', 'IT'];
  const puzzle = createPuzzle(1, { random: 0, excludedCodes: excluded, previousCode: 'GR' });
  assert.deepEqual(puzzle.excludedCodes, ['GR', 'IT']);
  excluded.push('PT');
  assert.deepEqual(puzzle.excludedCodes, ['GR', 'IT']);
  assert.ok(Object.isFrozen(puzzle.excludedCodes));
  assert.throws(() => puzzle.excludedCodes.push('PT'), TypeError);
  assert.equal(puzzle.excludedCodes.includes(puzzle.target), false);
});

test('a new Easy journey keeps its actual excluded answer pool and stable starter hint after saving and guessing', () => {
  const store = newStore();
  store.rounds.push(createPuzzle(1, { random: countriesForTier(1).findIndex(country => country.code === 'GR') }));
  for (const nextCode of ['IT', 'PT', 'ES']) {
    const current = getPuzzle(store);
    finish(store, current, true);
    const nextTier = store.tier === 3 ? 1 : store.tier + 1;
    const pool = countriesForTier(nextTier).filter(country => !store.rounds.some(round => round.target === country.code));
    const random = pool.findIndex(country => country.code === nextCode);
    assert.ok(random >= 0);
    assert.equal(restartPuzzle(store, { random }).target, nextCode);
  }
  const puzzle = getPuzzle(store);
  assert.equal(store.tier, 1);
  assert.deepEqual(puzzle.excludedCodes, ['GR', 'IT', 'PT']);
  assert.deepEqual(store.rounds, [puzzle], 'Previous journey boards are cleared while their answer exclusions remain');
  const country = findCountry(puzzle.target);
  assert.ok(!openingHintsFor(country, puzzle.tier, puzzle.excludedCodes).some(hint => hint.id === 'geo-un-location-southern-europe'));
  const expected = getOpeningHint(puzzle);
  const restored = restoreStore(JSON.stringify(store));
  const resumed = getPuzzle(restored);
  assert.deepEqual(resumed, puzzle);
  assert.ok(Object.isFrozen(resumed.excludedCodes));
  assert.equal(getOpeningHint(resumed), expected);
  assert.equal(recordGuess(restored, resumed, 'JP').ok, true);
  assert.equal(getOpeningHint(resumed), expected);
  assert.deepEqual(restored.stats, store.stats);
});

test('older journey saves recover known prefix exclusions without discarding progress', () => {
  const { store } = setup(3);
  const old = structuredClone(store);
  for (const puzzle of old.rounds) delete puzzle.excludedCodes;
  const restored = restoreStore(old);
  assert.deepEqual(restored, store);
  assert.deepEqual(restored.rounds.map(round => round.excludedCodes), [[], [store.rounds[0].target], store.rounds.slice(0, 2).map(round => round.target)]);
  assert.ok(restored.rounds.every(round => Object.isFrozen(round.excludedCodes)));
});

test('malformed saved exclusions restart only the affected round and preserve statistics', () => {
  const { store } = setup(2);
  const current = store.rounds[1];
  const cases = [null, 'GR', ['ZZ'], [current.target], ['GR', 'GR'], countriesForTier(1).slice(0, 16).map(country => country.code), Array(1)];
  for (const excludedCodes of cases) {
    const raw = structuredClone(store);
    raw.rounds[1].excludedCodes = excludedCodes;
    assert.equal(validPuzzle(raw.rounds[1]), false);
    const restored = restoreStore(raw);
    assert.equal(restored.tier, 2);
    assert.deepEqual(restored.rounds, [store.rounds[0]]);
    assert.deepEqual(restored.stats, store.stats);
    const fresh = getPuzzle(restored);
    assert.deepEqual(fresh.excludedCodes, [store.rounds[0].target]);
    assert.equal(validPuzzle(fresh), true);
  }
});

test('unknown and repeated countries never consume guesses; any country can be guessed at every tier', () => {
  for (const tier of [1, 2, 3]) {
    const { store, puzzle } = setup(tier);
    const stats = structuredClone(store.stats);
    assert.equal(recordGuess(store, puzzle, 'ZZ').error, 'unknown-country');
    assert.equal(puzzle.guesses.length, 0);
    assert.equal(recordGuess(store, puzzle, 'VA').ok, true);
    assert.equal(recordGuess(store, puzzle, 'VA').error, 'duplicate-country');
    assert.deepEqual(puzzle.guesses, ['VA']);
    assert.deepEqual(store.stats, stats);
  }
});

test('six wrong guesses finish a loss, reset streak, and count exactly once', () => {
  const { store, puzzle } = setup();
  Object.assign(store.stats, { played: 3, won: 3, streak: 3, best: 3, distribution: [3, 0, 0, 0, 0, 0] });
  for (const [index, code] of wrongCodes(puzzle).entries()) {
    const result = recordGuess(store, puzzle, code);
    assert.equal(result.ok, true);
    assert.equal(puzzle.finished, index === 5);
    assert.equal(result.clue.correct, false);
  }
  assert.equal(puzzle.won, false);
  assert.equal(puzzle.counted, true);
  assert.equal(store.stats.played, 4);
  assert.equal(store.stats.won, 3);
  assert.equal(store.stats.streak, 0);
  assert.equal(store.stats.best, 3);
  assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'finished');
  assert.equal(store.stats.played, 4);
  assert.equal(puzzle.guesses.length, 6);
});

test('early wins count once and stay completed after serialization', () => {
  const { store, puzzle } = setup();
  recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
  assert.equal(recordGuess(store, puzzle, puzzle.target).clue.correct, true);
  assert.equal(puzzle.finished, true);
  assert.equal(puzzle.won, true);
  assert.deepEqual(store.stats, { played: 1, won: 1, streak: 1, best: 1, distribution: [0, 1, 0, 0, 0, 0] });
  assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'finished');
  const restored = restoreStore(JSON.stringify(store));
  assert.deepEqual(restored.stats, store.stats);
  assert.equal(getPuzzle(restored).roundId, puzzle.roundId);
  assert.equal(recordGuess(restored, getPuzzle(restored), puzzle.target).error, 'finished');
  assert.equal(restored.stats.played, 1);
});

test('a correct sixth guess is a win and updates the sixth distribution bucket', () => {
  const { store, puzzle } = setup();
  for (const code of wrongCodes(puzzle).slice(0, 5)) recordGuess(store, puzzle, code);
  assert.equal(puzzle.finished, false);
  assert.equal(recordGuess(store, puzzle, puzzle.target).clue.correct, true);
  assert.equal(puzzle.won, true);
  assert.equal(puzzle.finished, true);
  assert.equal(puzzle.guesses.length, 6);
  assert.deepEqual(store.stats.distribution, [0, 0, 0, 0, 0, 1]);
  assert.equal(store.stats.played, 1);
  assert.equal(store.stats.won, 1);
});

for (let outcomes = 0; outcomes < 8; outcomes++) {
  const wins = [0, 1, 2].map(index => Boolean(outcomes & (1 << index)));
  test(`Easy, Medium, Hard then reset for outcomes ${wins.map(won => won ? 'win' : 'loss').join(', ')}`, () => {
    const { store } = setup();
    const targets = new Set();
    const identities = new Set();
    for (let tier = 1; tier <= 3; tier++) {
      const puzzle = getPuzzle(store);
      assert.equal(store.tier, tier);
      assert.equal(puzzle.tier, tier);
      assert.equal(store.rounds.length, tier);
      assert.equal(targets.has(puzzle.target), false);
      assert.equal(identities.has(puzzle.roundId), false);
      targets.add(puzzle.target);
      identities.add(puzzle.roundId);
      assert.throws(() => advanceJourney(store, puzzle), RangeError);
      finish(store, puzzle, wins[tier - 1]);
      assert.equal(store.stats.played, tier);
      assert.equal(store.stats.won, wins.slice(0, tier).filter(Boolean).length);
      assert.equal(store.rounds.filter(round => round.finished).length, tier);
      const stats = structuredClone(store.stats);
      const restored = restoreStore(JSON.stringify(store));
      assert.equal(restored.tier, tier);
      assert.equal(getPuzzle(restored).finished, true);
      assert.deepEqual(restored.stats, stats);
      const next = advanceJourney(store, puzzle);
      assert.deepEqual(store.stats, stats);
      assert.equal(next.finished, false);
      assert.equal(next.counted, false);
      assert.deepEqual(next.guesses, []);
      assert.equal(targets.has(next.target), false);
      assert.equal(identities.has(next.roundId), false);
      assert.equal(store.tier, tier === 3 ? 1 : tier + 1);
      assert.equal(store.rounds.length, tier === 3 ? 1 : tier + 1);
      assert.equal(getPuzzle(store), next);
      assert.throws(() => advanceJourney(store, puzzle), RangeError);
    }
    assert.equal(store.stats.played, 3);
    assert.equal(store.rounds[0].tier, 1);
    assert.equal(store.rounds.filter(round => round.finished).length, 0);
    assert.deepEqual(store.stats.distribution, [wins.filter(Boolean).length, 0, 0, 0, 0, 0]);
    finish(store, getPuzzle(store), true);
    assert.equal(store.stats.played, 4);
    assert.equal(store.rounds.filter(round => round.finished).length, 1);
  });
}

test('saved unfinished rounds resume at every tier with their stable identity and completed prefix', () => {
  for (const tier of [1, 2, 3]) {
    const { store, puzzle } = setup(tier);
    recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
    const snapshot = JSON.stringify(store);
    const firstTab = restoreStore(snapshot);
    const secondTab = restoreStore(snapshot);
    assert.equal(firstTab.tier, tier);
    assert.equal(firstTab.rounds.length, tier);
    assert.deepEqual(firstTab, secondTab);
    assert.deepEqual(getPuzzle(firstTab), puzzle);
    assert.notEqual(getPuzzle(firstTab), puzzle);
    assert.equal(firstTab.rounds.slice(0, -1).every(round => round.finished), true);
    assert.equal(recordGuess(firstTab, puzzle, puzzle.target).error, 'invalid-puzzle');
    assert.equal(recordGuess(secondTab, getPuzzle(secondTab), getPuzzle(secondTab).target).ok, true);
    const updatedTab = restoreStore(JSON.stringify(secondTab));
    assert.equal(getPuzzle(updatedTab).roundId, puzzle.roundId);
    assert.equal(getPuzzle(updatedTab).finished, true);
    assert.equal(updatedTab.stats.played, tier);
    assert.equal(recordGuess(updatedTab, getPuzzle(firstTab), puzzle.target).error, 'invalid-puzzle');
  }
});

test('version 1 saves keep normalized lifetime statistics and begin a fresh Easy journey', () => {
  const stats = { played: 12, won: 8, streak: 3, best: 5, distribution: [1, 2, 1, 2, 1, 1] };
  for (const mode of ['daily', 'journey']) {
    const old = { version: 1, mode, tier: 3, dailyTier: 3, journeyTier: 3, wins: [0, 2, 2, 9], daily: { saved: {} }, journeys: { 3: {} }, stats };
    const restored = restoreStore(JSON.stringify(old));
    assert.deepEqual(restored, { version: 2, tier: 1, rounds: [], recentAnswers: [], recentHints: [], stats });
    const puzzle = getPuzzle(restored);
    assert.equal(puzzle.tier, 1);
    assert.equal(puzzle.finished, false);
    assert.deepEqual(restored.stats, stats);
  }
});

test('malformed counters and distribution are bounded without losing valid history', () => {
  const { store, puzzle } = setup();
  store.stats = { played: 10, won: 99, streak: 30, best: -2, distribution: [7, 8, -2, 1.5, '3', 4, 50] };
  const restored = restoreStore(store);
  assert.deepEqual(restored.stats, { played: 10, won: 10, streak: 10, best: 10, distribution: [7, 3, 0, 0, 0, 0] });
  assert.equal(getPuzzle(restored).roundId, puzzle.roundId);
  for (const stats of [[], null, {}, { played: Number.MAX_SAFE_INTEGER + 1, won: Infinity, streak: '1', best: NaN }, { played: 2, won: 1, distribution: { 0: 1 } }]) {
    const recovered = restoreStore({ version: 2, stats });
    assert.equal(recovered.stats.distribution.every(value => value === 0), true);
    assert.equal(Number.isSafeInteger(recovered.stats.played), true);
  }
});

test('restore derives outcomes from guess history and never recounts saved completed rounds', () => {
  for (const won of [false, true]) {
    const { store, puzzle } = setup(3);
    finish(store, puzzle, won);
    const stats = structuredClone(store.stats);
    for (const round of store.rounds) Object.assign(round, { won: false, finished: false, counted: false });
    const restored = restoreStore(store);
    assert.equal(restored.tier, 3);
    assert.equal(getPuzzle(restored).finished, true);
    assert.equal(getPuzzle(restored).won, won);
    assert.equal(restored.rounds.every(round => round.counted), true);
    assert.deepEqual(restored.stats, stats);
    assert.equal(recordGuess(restored, getPuzzle(restored), puzzle.target).error, 'finished');
    restartPuzzle(restored, { random: 0 });
    assert.equal(restored.tier, 1);
    assert.deepEqual(restored.stats, stats);
  }
  const { store, puzzle } = setup();
  recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
  Object.assign(puzzle, { won: true, finished: true, counted: true });
  const restored = restoreStore(store);
  assert.equal(getPuzzle(restored).won, false);
  assert.equal(getPuzzle(restored).finished, false);
  assert.equal(getPuzzle(restored).counted, false);
  recordGuess(restored, getPuzzle(restored), getPuzzle(restored).target);
  assert.equal(restored.stats.played, 1);
});

test('restore cannot skip an unfinished, missing, mismatched or duplicate earlier round', () => {
  const { store } = setup(3);
  const mutations = [
    raw => { raw.rounds[0].guesses = []; },
    raw => { raw.rounds[0] = null; },
    raw => { raw.rounds[0].tier = 2; },
    raw => { raw.rounds = {}; },
    raw => { raw.rounds = Array(3); raw.rounds[2] = store.rounds[2]; },
  ];
  for (const mutate of mutations) {
    const raw = structuredClone(store);
    mutate(raw);
    const restored = restoreStore(raw);
    assert.equal(restored.tier, 1);
    assert.equal(getPuzzle(restored).tier, 1);
    assert.equal(restored.rounds.length, 1);
    assert.deepEqual(restored.stats, store.stats);
  }
  for (const duplicate of ['target', 'roundId']) {
    const raw = structuredClone(store);
    raw.rounds[1][duplicate] = raw.rounds[0][duplicate];
    if (duplicate === 'target') raw.rounds[1].guesses = [raw.rounds[1].target];
    const restored = restoreStore(raw);
    assert.equal(restored.tier, 2);
    assert.equal(restored.rounds.length, 1);
    const next = getPuzzle(restored);
    assert.equal(next.tier, 2);
    assert.notEqual(next.target, restored.rounds[0].target);
    assert.notEqual(next.roundId, restored.rounds[0].roundId);
  }
});

test('corrupt active history restarts its tier while retaining completed earlier rounds', () => {
  const mutations = [
    puzzle => { puzzle.target = 'ZZ'; },
    puzzle => { puzzle.tier = 3; },
    puzzle => { puzzle.guesses = ['US', 'US']; },
    puzzle => { puzzle.guesses = ['ZZ']; },
    puzzle => { puzzle.guesses = Array(2); },
    puzzle => { puzzle.guesses = ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'PE']; },
    puzzle => { puzzle.guesses = [puzzle.target, wrongCodes(puzzle)[0]]; },
    puzzle => { puzzle.roundId = '\ninvalid'; },
    puzzle => { delete puzzle.roundId; },
  ];
  for (const mutate of mutations) {
    const { store } = setup(2);
    const prefix = structuredClone(store.rounds[0]);
    mutate(store.rounds[1]);
    const restored = restoreStore(store);
    assert.equal(restored.tier, 2);
    assert.deepEqual(restored.rounds, [prefix]);
    const fresh = getPuzzle(restored);
    assert.equal(fresh.tier, 2);
    assert.deepEqual(fresh.guesses, []);
    assert.notEqual(fresh.target, prefix.target);
    assert.deepEqual(restored.stats, store.stats);
  }
  const { store } = setup();
  store.rounds[0].target = COUNTRIES.find(country => country.tier === 3).code;
  assert.equal(restoreStore(store).rounds.length, 0);
});

test('saved round arrays and guesses are copied and future boards cannot be resumed early', () => {
  const { store, puzzle } = setup(2);
  recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
  const restored = restoreStore(store);
  restored.rounds[1].guesses.push(wrongCodes(puzzle)[1]);
  assert.equal(store.rounds[1].guesses.length, 1);
  const future = createPuzzle(3, { excludedCodes: store.rounds.map(round => round.target) });
  store.rounds.push(future);
  const recovered = restoreStore(store);
  assert.equal(recovered.tier, 2);
  assert.equal(recovered.rounds.length, 2);
  assert.equal(getPuzzle(recovered).roundId, puzzle.roundId);
});

test('direct tier changes and sparse prefixes cannot award statistics or advance', () => {
  const { store, puzzle } = setup();
  const hard = createPuzzle(3, { random: 1 });
  store.tier = 3;
  store.rounds[2] = hard;
  assert.equal(recordGuess(store, hard, hard.target).error, 'invalid-puzzle');
  assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'invalid-puzzle');
  assert.equal(store.stats.played, 0);
  assert.throws(() => advanceJourney(store, hard), RangeError);
  assert.equal(getPuzzle(store), puzzle);
  assert.equal(store.tier, 1);
  assert.equal(store.rounds.length, 1);
});

test('detached, restored and stale completed boards cannot change the active round', () => {
  const { store, puzzle } = setup();
  const detached = { ...puzzle, guesses: [...puzzle.guesses] };
  assert.equal(recordGuess(store, detached, detached.target).error, 'invalid-puzzle');
  finish(store, puzzle, true);
  const completedClone = { ...puzzle, guesses: [...puzzle.guesses] };
  assert.throws(() => advanceJourney(store, completedClone), RangeError);
  const next = advanceJourney(store, puzzle);
  const stats = structuredClone(store.stats);
  assert.throws(() => advanceJourney(store, puzzle), RangeError);
  assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'invalid-puzzle');
  assert.equal(getPuzzle(store), next);
  assert.deepEqual(store.stats, stats);
  const restored = restoreStore(store);
  assert.equal(recordGuess(restored, next, next.target).error, 'invalid-puzzle');
  assert.equal(recordGuess(restored, getPuzzle(restored), getPuzzle(restored).target).ok, true);
});

test('reloading an unfinished round changes its target at the same tier without changing stats', () => {
  for (const tier of [1, 2, 3]) {
    const { store, puzzle } = setup(tier);
    recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
    const stats = structuredClone(store.stats);
    const prefix = structuredClone(store.rounds.slice(0, -1));
    const fresh = restartPuzzle(store, { random: 0 });
    assert.equal(store.tier, tier);
    assert.equal(fresh.tier, tier);
    assert.equal(store.rounds.length, tier);
    assert.notEqual(fresh.target, puzzle.target);
    assert.notEqual(fresh.roundId, puzzle.roundId);
    assert.deepEqual(fresh.guesses, []);
    assert.equal(fresh.counted, false);
    assert.equal(prefix.some(round => round.target === fresh.target), false);
    assert.deepEqual(store.rounds.slice(0, -1), prefix);
    assert.deepEqual(store.stats, stats);
    assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'invalid-puzzle');
    assert.deepEqual(getPuzzle(restoreStore(JSON.stringify(store))), fresh);
  }
});

test('reloading a completed round advances or resets after Hard without recounting it', () => {
  for (const tier of [1, 2, 3]) {
    for (const won of [false, true]) {
      const { store, puzzle } = setup(tier);
      finish(store, puzzle, won);
      const stats = structuredClone(store.stats);
      const priorTargets = store.rounds.map(round => round.target);
      const restored = restoreStore(JSON.stringify(store));
      const fresh = restartPuzzle(restored, { random: 0 });
      assert.equal(restored.tier, tier === 3 ? 1 : tier + 1);
      assert.equal(restored.rounds.length, tier === 3 ? 1 : tier + 1);
      assert.equal(fresh.tier, restored.tier);
      assert.equal(fresh.finished, false);
      assert.equal(fresh.counted, false);
      assert.deepEqual(fresh.guesses, []);
      assert.equal(priorTargets.includes(fresh.target), false);
      assert.deepEqual(restored.stats, stats);
      assert.throws(() => advanceJourney(restored, getPuzzle(store)), RangeError);
    }
  }
});

test('repeated reloads of completed journeys never add a fourth completed round to one journey', () => {
  const { store } = setup();
  for (let completed = 1; completed <= 9; completed++) {
    const puzzle = getPuzzle(store);
    assert.equal(puzzle.tier, ((completed - 1) % 3) + 1);
    finish(store, puzzle, completed % 2 === 1);
    const stats = structuredClone(store.stats);
    const restored = restoreStore(JSON.stringify(store));
    const next = restartPuzzle(restored, { random: completed });
    assert.equal(restored.stats.played, completed);
    assert.deepEqual(restored.stats, stats);
    assert.equal(restored.rounds.filter(round => round.finished).length, completed % 3);
    assert.equal(next.tier, (completed % 3) + 1);
    Object.assign(store, restored);
  }
});

test('invalid reload options do not discard a board or partially advance its journey', () => {
  for (const finished of [false, true]) {
    const { store, puzzle } = setup(2);
    if (finished) finish(store, puzzle, true);
    const snapshot = structuredClone(store);
    assert.throws(() => restartPuzzle(store, { random: -1 }), RangeError);
    assert.deepEqual(store, snapshot);
    assert.equal(getPuzzle(store), puzzle);
  }
});

test('round identities survive guesses and storage while every new board receives a new identity', () => {
  const { store, puzzle } = setup();
  const id = puzzle.roundId;
  recordGuess(store, puzzle, wrongCodes(puzzle)[0]);
  assert.equal(puzzle.roundId, id);
  assert.equal(getPuzzle(restoreStore(JSON.stringify(store))).roundId, id);
  const fresh = restartPuzzle(store, { random: 0 });
  assert.notEqual(fresh.roundId, id);
  finish(store, fresh, true);
  const next = advanceJourney(store, fresh);
  assert.notEqual(next.roundId, fresh.roundId);
  const first = createPuzzle(1, { random: 7 });
  const second = createPuzzle(1, { random: 7 });
  assert.equal(first.target, second.target);
  assert.notEqual(first.roundId, second.roundId);
});

test('counter increments remain safe at the maximum supported integer', () => {
  const { store, puzzle } = setup();
  Object.assign(store.stats, { played: Number.MAX_SAFE_INTEGER, won: Number.MAX_SAFE_INTEGER, streak: Number.MAX_SAFE_INTEGER, best: Number.MAX_SAFE_INTEGER, distribution: [Number.MAX_SAFE_INTEGER, 0, 0, 0, 0, 0] });
  finish(store, puzzle, true);
  assert.equal(Object.values(store.stats).flat().every(Number.isSafeInteger), true);
  assert.equal(store.stats.played, Number.MAX_SAFE_INTEGER);
  assert.equal(store.stats.won, Number.MAX_SAFE_INTEGER);
  assert.equal(store.stats.distribution[0], Number.MAX_SAFE_INTEGER);
});
