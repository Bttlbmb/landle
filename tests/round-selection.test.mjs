import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COUNTRIES } from '../data.js';
import { STARTING_HINTS, HINT_BANK_VERSION, HINT_RULES } from '../starting-hints.js';
import { createHintSelector } from '../hint-selection.js';
import { countriesForTier, countriesForRound, openingHintsFor, chooseOpeningHint } from '../geography.js';
import { newStore, getPuzzle, getOpeningHint, restoreStore, recordGuess, advanceJourney, restartPuzzle, createPuzzle, validPuzzle } from '../game-state.js';

const bank = JSON.parse(await readFile(new URL('../starting-hints.json', import.meta.url), 'utf8'));
const catalog = new Map(bank.catalog.map(hint => [hint.id, hint]));
const country = code => COUNTRIES.find(item => item.code === code);
const text = id => catalog.get(id).text;

function assertBreadth(puzzle) {
  const pool = countriesForRound(puzzle.tier, puzzle.excludedCodes);
  const hint = catalog.get(puzzle.hintId);
  assert.ok(hint.matches.includes(puzzle.target), 'Displayed hint is true for the selected answer');
  const confirmed = pool.filter(item => hint.matches.includes(item.code)).length;
  const maximum = pool.filter(item => [...hint.matches, ...hint.possibleExtraMatches].includes(item.code)).length;
  assert.ok(confirmed >= 4, hint.id + ' leaves ' + confirmed + ' confirmed answers');
  assert.ok(maximum <= pool.length * 0.7, hint.id + ' matches up to ' + maximum + '/' + pool.length + ' answers');
}

function assertCooldown(puzzle, earlierHints) {
  const recent = earlierHints.slice(-6).map(text);
  const choices = openingHintsFor(country(puzzle.target), puzzle.tier, puzzle.excludedCodes);
  const selected = getOpeningHint(puzzle);
  if (recent.includes(selected)) {
    assert.ok(choices.every(hint => recent.includes(hint.text)), 'Reuse only when every eligible alternative is on cooldown');
    assert.equal(recent.lastIndexOf(selected), Math.min(...choices.map(hint => recent.lastIndexOf(hint.text))),
      'Fallback uses the least recently shown eligible wording');
  }
}

test('runtime membership matches the deployed reviewed bank and remains immutable', () => {
  assert.equal(bank.contentSha256, HINT_BANK_VERSION);
  for (const hints of Object.values(STARTING_HINTS)) {
    for (const hint of hints) {
      const reviewed = catalog.get(hint.id);
      assert.deepEqual(hint.matches, reviewed.matches);
      assert.deepEqual(hint.possibleExtraMatches, reviewed.possibleExtraMatches);
      assert.ok(Object.isFrozen(hint.matches));
      assert.ok(Object.isFrozen(hint.possibleExtraMatches));
    }
  }
});

test('a thousand completed rounds keep answer and hint cooldowns across journeys and saved progress', () => {
  let store = newStore();
  let puzzle = getPuzzle(store);
  const completed = [];
  const shown = [];
  for (let index = 0; index < 1000; index++) {
    assert.ok(!completed.slice(-12).includes(puzzle.target), 'No answer repeats within twelve completed rounds');
    assert.ok(completed.slice(-12).every(code => puzzle.excludedCodes.includes(code)));
    assertBreadth(puzzle);
    assertCooldown(puzzle, shown);
    shown.push(puzzle.hintId);
    assert.deepEqual(store.recentHints.map(entry => entry.hintId), shown.slice(-6));
    if (index % 5 === 0) {
      for (const guess of COUNTRIES.filter(item => item.code !== puzzle.target).slice(0, 6)) {
        assert.equal(recordGuess(store, puzzle, guess.code).ok, true);
      }
    } else assert.equal(recordGuess(store, puzzle, puzzle.target).ok, true);
    completed.push(puzzle.target);
    assert.deepEqual(store.recentAnswers.map(entry => entry.code), completed.slice(-12));
    assert.equal(store.stats.played, index + 1);
    const hint = getOpeningHint(puzzle);
    const snapshot = JSON.stringify(store);
    store = restoreStore(snapshot);
    assert.deepEqual(store, JSON.parse(snapshot), 'Restoring does not change history, selected hints, or statistics');
    puzzle = getPuzzle(store);
    assert.equal(getOpeningHint(puzzle), hint);
    const savedHistory = structuredClone([store.recentAnswers, store.recentHints]);
    assert.equal(recordGuess(store, puzzle, puzzle.target).error, 'finished');
    assert.deepEqual([store.recentAnswers, store.recentHints], savedHistory, 'Completed boards never consume the cooldown twice');
    puzzle = advanceJourney(store, puzzle, { random: Math.imul(index + 1, 2654435761) >>> 0 });
  }
  assert.equal(store.stats.played, 1000);
  assert.equal(store.stats.won, 800);
});

test('finished answers expire after twelve rounds; bounded corrupt history is copied and normalized', () => {
  const codes = countriesForTier(1).slice(0, 13).map(item => item.code);
  const raw = { ...newStore(), recentAnswers: [
    null, { roundId: 'invalid-code', code: 'ZZ' },
    ...codes.map((code, index) => ({ roundId: 'old-' + index, code })),
    { roundId: 'old-12', code: codes[12] },
  ], recentHints: [null, { roundId: 'bad-hint', hintId: 'unreviewed' }] };
  const restored = restoreStore(raw);
  assert.deepEqual(restored.recentAnswers.map(entry => entry.code), codes.slice(-12));
  assert.deepEqual(restored.recentHints, []);
  const puzzle = getPuzzle(restored);
  assert.ok(!puzzle.excludedCodes.includes(codes[0]), 'The thirteenth oldest answer has expired');
  assert.ok(countriesForRound(1, puzzle.excludedCodes).some(item => item.code === codes[0]));
  assert.ok(codes.slice(-12).every(code => !countriesForRound(1, puzzle.excludedCodes).some(item => item.code === code)));
  raw.recentAnswers.at(-1).code = 'JP';
  assert.equal(restored.recentAnswers.at(-1).code, codes[12]);
  assert.ok(Object.isFrozen(puzzle.excludedCodes));
});

test('reloading abandons a board without consuming an answer and records only the last six shown hints', () => {
  const store = newStore();
  const first = getPuzzle(store);
  assert.equal(recordGuess(store, first, first.target).ok, true);
  let puzzle = advanceJourney(store, first, { random: 0 });
  const shown = store.recentHints.map(entry => entry.hintId);
  const answers = structuredClone(store.recentAnswers);
  const stats = structuredClone(store.stats);
  for (let index = 0; index < 10; index++) {
    const abandoned = puzzle;
    puzzle = restartPuzzle(store, { random: index });
    assert.notEqual(puzzle.target, abandoned.target);
    assertCooldown(puzzle, shown);
    shown.push(puzzle.hintId);
    assertBreadth(puzzle);
    assert.deepEqual(store.recentAnswers, answers);
    assert.deepEqual(store.stats, stats);
    assert.deepEqual(store.recentHints.map(entry => entry.hintId), shown.slice(-6));
    assert.equal(recordGuess(store, abandoned, abandoned.target).error, 'invalid-puzzle');
    const restored = restoreStore(JSON.stringify(store));
    assert.deepEqual(restored, store, 'Old prefix hints must not be added back after aging out');
  }
});

test('legacy version two boards keep their identity, guesses and fair seeded hint while gaining history', () => {
  const store = newStore();
  let puzzle = getPuzzle(store);
  recordGuess(store, puzzle, puzzle.target);
  puzzle = advanceJourney(store, puzzle, { random: 0 });
  const wrong = COUNTRIES.find(item => item.code !== puzzle.target);
  recordGuess(store, puzzle, wrong.code);
  const expectedHint = chooseOpeningHint(country(puzzle.target), puzzle.roundId, puzzle.tier, puzzle.excludedCodes).text;
  const old = structuredClone(store);
  delete old.recentAnswers;
  delete old.recentHints;
  for (const round of old.rounds) delete round.hintId;
  const restored = restoreStore(old);
  const current = getPuzzle(restored);
  assert.equal(current.target, puzzle.target);
  assert.equal(current.roundId, puzzle.roundId);
  assert.deepEqual(current.guesses, puzzle.guesses);
  assert.equal(getOpeningHint(current), expectedHint);
  assert.deepEqual(restored.stats, store.stats);
  assert.equal(restored.recentAnswers.length, 1);
  assert.equal(restored.recentHints.length, 2);
  const snapshot = JSON.stringify(restored);
  assert.equal(JSON.stringify(restoreStore(snapshot)), snapshot);
});

test('an opening hint remains fixed through wrong guesses, serialization and an evolving cooldown', () => {
  const store = newStore();
  const puzzle = getPuzzle(store);
  const hint = getOpeningHint(puzzle);
  const pool = countriesForRound(puzzle.tier, puzzle.excludedCodes).map(item => item.code);
  const exclusions = [...puzzle.excludedCodes];
  for (const wrong of COUNTRIES.filter(item => item.code !== puzzle.target).slice(0, 5)) {
    assert.equal(recordGuess(store, puzzle, wrong.code).ok, true);
    assert.equal(getOpeningHint(puzzle), hint);
    assert.equal(getOpeningHint(getPuzzle(restoreStore(JSON.stringify(store)))), hint);
    assert.deepEqual(puzzle.excludedCodes, exclusions);
    assert.deepEqual(countriesForRound(puzzle.tier, puzzle.excludedCodes).map(item => item.code), pool);
  }
});

test('cooldown avoids every recent eligible hint and falls back to the least recent eligible wording', () => {
  const japan = country('JP');
  const selector = createHintSelector({ ...STARTING_HINTS, JP: openingHintsFor(japan, 1).slice(0, 4) }, HINT_RULES);
  const hints = selector.openingHintsFor(japan, 1);
  const choose = selector.chooseOpeningHint;
  for (const onlyFresh of hints) {
    const recent = hints.filter(hint => hint.id !== onlyFresh.id).map(hint => hint.id);
    for (let seed = 0; seed < 16; seed++) assert.equal(choose(japan, 'seed-' + seed, 1, [], recent).id, onlyFresh.id);
  }
  const recent = [...hints.map(hint => hint.id), hints[0].id];
  for (let seed = 0; seed < 16; seed++) assert.equal(choose(japan, 'seed-' + seed, 1, [], recent).id, hints[1].id);
  const noCooldown = [...hints.map(hint => hint.id), ...Array(6).fill(Object.values(STARTING_HINTS).flat().find(hint => !hints.some(item => item.text === hint.text)).id)];
  const choices = new Set(Array.from({ length: 64 }, (_, seed) => choose(japan, 'seed-' + seed, 1, [], noCooldown).id));
  assert.deepEqual(choices, new Set(hints.map(hint => hint.id)), 'Only the most recent six hints count');
});

test('shrinking the round pool rejects too-specific and too-broad hints even as cooldown fallbacks', () => {
  const france = country('FR');
  const narrow = 'geo-un-location-western-europe';
  const exclusions = ['AT', 'DE'];
  assert.ok(openingHintsFor(france, 1).some(hint => hint.id === narrow));
  const eligible = openingHintsFor(france, 1, exclusions);
  assert.ok(!eligible.some(hint => hint.id === narrow), 'Five matches reduced to three must be rejected');
  const shortlist = eligible.slice(0, 3);
  const selector = createHintSelector({ ...STARTING_HINTS, FR: [...shortlist, STARTING_HINTS.FR.find(hint => hint.id === narrow)] }, HINT_RULES);
  const recent = [narrow, ...shortlist.map(hint => hint.id)];
  for (let seed = 0; seed < 16; seed++) {
    const chosen = selector.chooseOpeningHint(france, 'fallback-' + seed, 1, exclusions, recent);
    assert.equal(chosen.id, shortlist[0].id, 'An ineligible but older hint is never a fallback');
  }
  const easy = countriesForTier(1);
  let rejectedBroadHint = false;
  for (const target of easy) {
    for (const hint of openingHintsFor(target, 1)) {
      const fact = catalog.get(hint.id);
      const possible = new Set([...fact.matches, ...fact.possibleExtraMatches]);
      const excluded = easy.filter(item => !possible.has(item.code)).slice(0, 12).map(item => item.code);
      const remaining = easy.filter(item => !excluded.includes(item.code));
      if (remaining.filter(item => possible.has(item.code)).length <= remaining.length * 0.7) continue;
      const pool = countriesForRound(1, excluded);
      if (!pool.includes(target)) continue;
      assert.ok(!openingHintsFor(target, 1, excluded).some(item => item.id === hint.id));
      rejectedBroadHint = true;
    }
  }
  assert.ok(rejectedBroadHint, 'The upper breadth bound needs at least one adversarial fixture');
});

test('adversarial answer cooldowns leave only uniformly selectable answers with fair hints', () => {
  let state = 0x12345678;
  for (const tier of [1, 2, 3]) {
    const base = countriesForTier(tier);
    for (let trial = 0; trial < 100; trial++) {
      const shuffled = [...base];
      for (let index = shuffled.length - 1; index > 0; index--) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        const other = (state >>> 0) % (index + 1);
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }
      const exclusions = shuffled.slice(0, 12).map(item => item.code);
      const pool = countriesForRound(tier, exclusions);
      assert.ok(Object.isFrozen(pool));
      for (const target of pool) {
        const hints = openingHintsFor(target, tier, exclusions);
        for (const hint of hints) assertBreadth({ target: target.code, tier, hintId: hint.id, excludedCodes: exclusions });
      }
      const puzzle = createPuzzle(tier, { excludedCodes: exclusions, random: state >>> 0 });
      assert.equal(puzzle.target, pool[(state >>> 0) % pool.length].code);
      assert.equal(validPuzzle(puzzle), true);
    }
  }
});

test('invalid round creation or advancement cannot consume cooldown history or statistics', () => {
  const store = newStore();
  const puzzle = getPuzzle(store);
  recordGuess(store, puzzle, puzzle.target);
  const snapshot = structuredClone(store);
  assert.throws(() => advanceJourney(store, puzzle, { random: -1 }), RangeError);
  assert.deepEqual(store, snapshot);
  assert.throws(() => createPuzzle(1, { recentHintIds: ['unreviewed'] }), RangeError);
  assert.throws(() => createPuzzle(1, { excludedCodes: ['ZZ'] }), RangeError);
  assert.throws(() => createPuzzle(1, { excludedCodes: countriesForTier(1).slice(0, 16).map(item => item.code) }), RangeError);
});
