import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COUNTRIES } from '../../data.js';

// Publish only a bank certified by both independent reviews.
const directory = new URL('./', import.meta.url);
const bytes = await readFile(new URL('bank.json', directory), 'utf8');
const bank = JSON.parse(bytes);
const candidate = process.argv.includes('--candidate');
const digest = createHash('sha256').update(JSON.stringify({
  rules: bank.rules, catalog: bank.catalog, countries: bank.countries,
})).digest('hex');
assert.equal(bank.contentSha256, digest, 'Hint bank content has changed since review.');
assert.deepEqual(bank.unresolved, [], 'Every country needs four usable examples.');
if (!candidate) {
  assert.equal(bank.status, 'reviewed', 'Hint bank must be reviewed before export.');
  assert.equal(bank.reviews.length, 2);
  for (const certificate of bank.reviews) {
    assert.ok(['revised-accuracy-review.json', 'revised-fairness-review.json'].includes(certificate.file));
    const review = JSON.parse(await readFile(new URL(certificate.file, directory), 'utf8'));
    assert.equal(review.status, 'passed', certificate.file);
    assert.equal(review.reviewedContentSha256, digest, certificate.file);
  }
}
assert.equal(bank.countries.length, COUNTRIES.length);
const catalog = new Map(bank.catalog.map(hint => [hint.id, hint]));
const ids = {};
const phrases = {};
for (const country of COUNTRIES) {
  const entry = bank.countries.find(item => item.code === country.code);
  assert.equal(entry?.name, country.name, country.code);
  assert.equal(entry.tier, country.tier, country.code);
  assert.equal(entry.hints.length, bank.rules.hintsPerCountry, country.code);
  assert.equal(new Set(entry.hints).size, entry.hints.length, country.code);
  assert.ok(entry.hints.every(id => entry.alternatives.includes(id)), country.code);
  ids[country.code] = entry.alternatives;
  for (const id of entry.alternatives) {
    const hint = catalog.get(id);
    assert.ok(hint?.matches.includes(country.code), country.name + ': ' + id);
    assert.ok(hint.eligibleTiers.some(tier => tier >= country.tier), country.name + ': ' + id);
    for (const tier of hint.eligibleTiers) {
      assert.ok(hint.counts[tier] >= bank.rules.minimumMatches, id);
      assert.ok(hint.maximumCounts[tier] >= bank.rules.minimumPossibleMatches[tier], id);
      assert.ok(hint.maximumCounts[tier] <= bank.rules.maximumFraction * bank.rules.pools[tier], id);
    }
    phrases[id] = { id, text: hint.text, family: hint.family, dimension: hint.dimension,
      eligibleTiers: hint.eligibleTiers, matches: hint.matches, possibleExtraMatches: hint.possibleExtraMatches };
  }
}
const source = [
  candidate ? '// Candidate bank for independent review; not deployed. Do not edit by hand.'
    : '// Generated from the independently reviewed hint bank. Do not edit by hand.',
  '// Regenerate with node research/starting-hints/export.mjs.',
  '// Sources and attribution are retained in starting-hints.json and DATA_SOURCES.md.',
  'export const HINT_BANK_VERSION = ' + JSON.stringify(digest) + ';',
  'export const HINT_RULES = Object.freeze(' + JSON.stringify(bank.rules) + ');',
  'for (const value of Object.values(HINT_RULES)) if (value && typeof value === "object") Object.freeze(value);',
  'const catalog = ' + JSON.stringify(phrases, null, 2) + ';',
  'for (const hint of Object.values(catalog)) {',
  '  Object.freeze(hint.eligibleTiers);',
  '  Object.freeze(hint.matches);',
  '  Object.freeze(hint.possibleExtraMatches);',
  '  Object.freeze(hint);',
  '}',
  'Object.freeze(catalog);',
  'const countryHints = ' + JSON.stringify(ids, null, 2) + ';',
  'export const STARTING_HINTS = Object.freeze(Object.fromEntries(',
  '  Object.entries(countryHints).map(([code, ids]) => [code, Object.freeze(ids.map(id => catalog[id]))])',
  '));',
  '',
].join('\n');
if (candidate) {
  await writeFile(new URL('candidate-hints.js', directory), source);
  console.log('Candidate hints are ready for independent review. The game export is unchanged.');
} else {
  await writeFile(new URL('../../starting-hints.js', directory), source);
  await writeFile(new URL('../../starting-hints.json', directory), bytes);
  console.log('Exported the reviewed starting hints for all ' + COUNTRIES.length + ' countries.');
}
