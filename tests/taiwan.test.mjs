import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findCountry, countriesForRound, clueFor, openingHintsFor } from '../geography.js';
import { newStore, createPuzzle, recordGuess, restoreStore } from '../game-state.js';

const taiwan = findCountry('Taiwan');

function journeyAt(tier, target) {
  const store = newStore();
  const previous = [];
  for (let roundTier = 1; roundTier <= tier; roundTier++) {
    const code = roundTier === tier ? target : ['FR', 'IT'][roundTier - 1];
    const pool = countriesForRound(roundTier, previous);
    const puzzle = createPuzzle(roundTier, { excludedCodes: previous, random: pool.findIndex(c => c.code === code) });
    store.tier = roundTier;
    store.rounds.push(puzzle);
    if (roundTier < tier) {
      assert.equal(recordGuess(store, puzzle, code).ok, true);
      previous.push(code);
    }
  }
  return store;
}
test('Taiwan has sourced population, land area and geography hints', async () => {
  assert.equal(taiwan.population, 23400220);
  assert.equal(taiwan.area, 32260);
  assert.equal(taiwan.region, 'Asia');
  const bank = JSON.parse(await readFile(new URL('../starting-hints.json', import.meta.url)));
  const expected = new Set(['geo-no-land-neighbours', 'geo-island-country', 'geo-region-asia', 'geo-island-country-asia', 'geo-pacific-coast']);
  assert.deepEqual(new Set(bank.catalog.filter(h => h.family === 'geography' && h.matches.includes('TW')).map(h => h.id)), expected);
  for (const hint of bank.catalog.filter(h => h.matches.includes('TW') && h.family !== 'name')) {
    assert.ok(hint.sources.some(source => hint.family === 'population' ? source.includes('ris.gov.tw') : source.includes('cia.gov')), hint.id);
  }
  assert.equal(clueFor(taiwan, findCountry('China')).direction, '↖');
  assert.equal(clueFor(taiwan, findCountry('China')).population, 'up');
  assert.equal(clueFor(taiwan, findCountry('China')).area, 'up');
});
test('Taiwan can be guessed at every tier and selected as a Medium or Hard answer', () => {
  for (const tier of [1, 2, 3]) {
    const pool = countriesForRound(tier);
    assert.equal(pool.some(c => c.code === 'TW'), tier >= 2);
    const store = journeyAt(tier, 'JP');
    const puzzle = store.rounds[tier - 1];
    assert.equal(recordGuess(store, puzzle, 'TW').ok, true);
    assert.deepEqual(puzzle.guesses, ['TW']);
    assert.deepEqual(restoreStore(JSON.parse(JSON.stringify(store))).rounds[tier - 1].guesses, ['TW']);
  }
  for (const tier of [2, 3]) {
    const store = journeyAt(tier, 'TW');
    const puzzle = store.rounds[tier - 1];
    assert.equal(puzzle.target, 'TW');
    assert.ok(openingHintsFor(taiwan, tier).some(h => h.id === puzzle.hintId));
    assert.equal(recordGuess(store, puzzle, 'TW').ok, true);
    assert.equal(puzzle.won, true);
    assert.equal(puzzle.finished, true);
    assert.equal(restoreStore(JSON.parse(JSON.stringify(store))).rounds[tier - 1].target, 'TW');
    assert.ok(!countriesForRound(tier, ['TW']).some(c => c.code === 'TW'));
  }
});
