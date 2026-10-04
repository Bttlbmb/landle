// Independent state/selection review. This does not change app or bank behavior.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { COUNTRIES } from '../../data.js';
import { newStore, createPuzzle, recordGuess, restartPuzzle, restoreStore } from '../../game-state.js';
import { chooseOpeningHint, openingHintsFor } from './candidate-selection.js';
import { readBankForReadyAudit } from './revised-fairness-audit.mjs';

const flag = process.argv.indexOf('--expected-hash');
const expectedHash = flag < 0 ? undefined : process.argv[flag + 1];
const { digest } = readBankForReadyAudit(expectedHash);
const hash = path => crypto.createHash('sha256').update(fs.readFileSync(new URL(path, import.meta.url))).digest('hex');
const sourcePaths = ['../../data.js', '../../hint-selection.js', './candidate-selection.js', './candidate-hints.js', '../../game-state.js'];
const randomFor = (code, tier, excluded = []) => COUNTRIES.filter(country => country.tier <= tier && !excluded.includes(country.code)).findIndex(country => country.code === code);
const countryFor = code => COUNTRIES.find(country => country.code === code);
const selectionFor = puzzle => chooseOpeningHint(countryFor(puzzle.target), puzzle.roundId, puzzle.tier, puzzle.excludedCodes).id;

const store = newStore();
const greece = createPuzzle(1, { random: randomFor('GR', 1) });
store.rounds = [greece];
assert.equal(recordGuess(store, greece, 'GR').ok, true);
const italy = restartPuzzle(store, { random: randomFor('IT', 2, ['GR']) });
assert.equal(italy.target, 'IT');
assert.equal(recordGuess(store, italy, 'IT').ok, true);
const portugal = restartPuzzle(store, { random: randomFor('PT', 3, ['GR', 'IT']) });
assert.equal(portugal.target, 'PT');
assert.equal(recordGuess(store, portugal, 'PT').ok, true);
const spain = restartPuzzle(store, { random: randomFor('ES', 1, ['GR', 'IT', 'PT']) });
assert.equal(spain.target, 'ES');
assert.deepEqual(spain.excludedCodes, ['GR', 'IT', 'PT']);
assert.equal(openingHintsFor(countryFor('ES'), 1, spain.excludedCodes).some(hint => hint.id === 'geo-un-location-southern-europe'), false);
const initialHint = selectionFor(spain);
const restored = restoreStore(JSON.stringify(store));
const restoredSpain = restored.rounds[0];
assert.equal(restoredSpain.roundId, spain.roundId);
assert.equal(restoredSpain.target, spain.target);
assert.deepEqual(restoredSpain.excludedCodes, spain.excludedCodes);
assert.equal(selectionFor(restoredSpain), initialHint);
assert.equal(recordGuess(restored, restoredSpain, 'CA').ok, true);
assert.equal(selectionFor(restoredSpain), initialHint);
assert.equal(chooseOpeningHint(countryFor('ES'), spain.roundId, 1, ['PT', 'GR', 'IT', 'GR']).id, initialHint);
assert.equal(Object.isFrozen(spain.excludedCodes), true);
assert.equal(Object.isFrozen(restoredSpain.excludedCodes), true);

const inputExclusions = ['GR', 'IT'];
const copied = createPuzzle(3, { excludedCodes: inputExclusions, random: randomFor('JP', 3, inputExclusions) });
inputExclusions.push('PT');
assert.deepEqual(copied.excludedCodes, ['GR', 'IT']);
assert.equal(Object.isFrozen(copied.excludedCodes), true);

const legacyStore = newStore();
const legacyGreece = createPuzzle(1, { random: randomFor('GR', 1) });
legacyStore.rounds = [legacyGreece];
assert.equal(recordGuess(legacyStore, legacyGreece, 'GR').ok, true);
restartPuzzle(legacyStore, { random: randomFor('IT', 2, ['GR']) });
const legacyRaw = JSON.parse(JSON.stringify(legacyStore));
for (const puzzle of legacyRaw.rounds) delete puzzle.excludedCodes;
const recoveredLegacy = restoreStore(legacyRaw);
assert.deepEqual(recoveredLegacy.rounds.map(puzzle => puzzle.excludedCodes), [[], ['GR']]);
assert.equal(recoveredLegacy.rounds.every(puzzle => Object.isFrozen(puzzle.excludedCodes)), true);

const netherlands = countryFor('NL');
assert.equal(openingHintsFor(netherlands, 3, []).some(hint => hint.id === 'geo-north-sea-coast'), true);
assert.equal(openingHintsFor(netherlands, 3, ['SE', 'BE']).some(hint => hint.id === 'geo-north-sea-coast'), false);
assert.equal(openingHintsFor(netherlands, 3, ['FR', 'BE']).some(hint => hint.id === 'geo-north-sea-coast'), false);

const output = {
  contentSha256: digest,
  generatedAt: new Date().toISOString(),
  status: 'passed public API lifecycle checks; no editorial verdict',
  sourceHashes: sourcePaths.map(path => ({ path: path.replace(/^\.\.\/\.\.\//, '').replace(/^\.\//, 'research/starting-hints/'), sha256: hash(path) })),
  historyExclusionReproduction: {
    previousJourney: ['GR', 'IT', 'PT'], nextEasyTarget: 'ES', persistedExcludedCodes: [...spain.excludedCodes],
    staleSouthernEuropeHintSuppressed: true,
  },
  actualPoolCompleteness: {
    northSeaEligibleBeforeExclusions: true,
    northSeaExcludedWithSwedenAndBelgiumRemoved: true,
    note: 'Removing Sweden, the declared extra, and Belgium, a confirmed member, leaves six confirmed and six possible North Sea candidates, rejected on Hard.',
    northSeaExcludedWithFranceAndBelgiumRemoved: true,
    possibleUnionNote: 'A valid France-to-Belgium journey leaves five confirmed and six declared possible North Sea answers on Hard. The revised possible-union minimum also rejects this partial set.',
  },
  identity: {
    sameRoundIdAfterRestore: true, sameTargetAfterRestore: true, sameExclusionsAfterRestore: true,
    sameHintAfterRestore: true, sameHintAfterGuess: true, exclusionOrderAndDuplicateInsensitive: true,
    copiedInputExclusions: true, frozenCreatedAndRestoredExclusions: true,
  },
  legacy: { earlierJourneyExclusionsFilled: true, legacyRestoredExclusions: recoveredLegacy.rounds.map(puzzle => [...puzzle.excludedCodes]) },
  scope: 'Candidate selector and current state implementation within the exact bank version. Explicit new-round actions create new identities; cross-version hint stability is not claimed.',
};
fs.writeFileSync(new URL('./revised-fairness-lifecycle-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
