import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRIES } from '../../data.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REVIEW_FILES = ['revised-accuracy-review.json', 'revised-fairness-review.json'];

/** Reviews certify content, independent of JSON formatting or file location. */
export async function loadHintBank(root = ROOT, { candidate = false } = {}) {
  const bank = JSON.parse(await readFile(join(root, 'starting-hints.json'), 'utf8'));
  const digest = createHash('sha256').update(JSON.stringify({
    rules: bank.rules, catalog: bank.catalog, countries: bank.countries,
  })).digest('hex');
  assert.equal(bank.contentSha256, digest, 'Hint bank content has changed since review.');
  assert.deepEqual(bank.unresolved, [], 'Every country needs four usable examples.');
  if (!candidate) {
    assert.equal(bank.status, 'reviewed', 'Hint bank must be reviewed before export.');
    // Checking the exact pair prevents two copies of one certificate from
    // standing in for separate fact and fairness reviews.
    assert.deepEqual(bank.reviews?.map(review => review.file).sort(), [...REVIEW_FILES].sort(),
      'Both fact and fairness certificates are required.');
    for (const certificate of bank.reviews) {
      const review = JSON.parse(await readFile(join(root, 'research/starting-hints', certificate.file), 'utf8'));
      assert.equal(certificate.reviewedContentSha256, digest, certificate.file);
      assert.equal(review.status, 'passed', certificate.file);
      assert.equal(review.reviewedContentSha256, digest, certificate.file);
    }
  }
  return bank;
}

/** Export one copy of each phrase; derive assignments from its reviewed matches. */
export function hintRuntimeSource(bank, { candidate = false } = {}) {
  assert.equal(bank.countries.length, COUNTRIES.length);
  assert.equal(new Set(bank.catalog.map(hint => hint.id)).size, bank.catalog.length, 'Duplicate hint IDs.');
  const phrases = bank.catalog.map(hint => ({ id: hint.id, text: hint.text, family: hint.family,
    dimension: hint.dimension, eligibleTiers: hint.eligibleTiers, matches: hint.matches,
    possibleExtraMatches: hint.possibleExtraMatches }));
  for (const country of COUNTRIES) {
    const entry = bank.countries.find(item => item.code === country.code);
    assert.equal(entry?.name, country.name, country.code);
    assert.equal(entry.tier, country.tier, country.code);
    assert.equal(entry.hints.length, bank.rules.hintsPerCountry, country.code);
    assert.equal(new Set(entry.hints).size, entry.hints.length, country.code);
    assert.ok(entry.hints.every(id => entry.alternatives.includes(id)), country.code);
    const alternatives = phrases.filter(hint => hint.matches.includes(country.code)
      && hint.eligibleTiers.some(tier => tier >= country.tier));
    // The derived list must preserve both membership and the certified order.
    assert.deepEqual(alternatives.map(hint => hint.id), entry.alternatives, country.code);
  }
  for (const hint of bank.catalog) {
    for (const tier of hint.eligibleTiers) {
      assert.ok(hint.counts[tier] >= bank.rules.minimumMatches, hint.id);
      assert.ok(hint.maximumCounts[tier] >= bank.rules.minimumPossibleMatches[tier], hint.id);
      assert.ok(hint.maximumCounts[tier] <= bank.rules.maximumFraction * bank.rules.pools[tier], hint.id);
    }
  }
  // Generated records use one line each: readable enough to inspect, without
  // repeated country-to-phrase lists or pretty-printed arrays in the download.
  return [
    candidate ? '// Candidate hints for review; not deployed. Do not edit by hand.'
      : '// Generated from the reviewed starting-hints.json. Do not edit by hand.',
    '// Regenerate with node research/starting-hints/export.mjs.',
    '// Sources and attribution: starting-hints.json and DATA_SOURCES.md.',
    "import { COUNTRIES } from './data.js';",
    'export const HINT_BANK_VERSION = ' + JSON.stringify(bank.contentSha256) + ';',
    'export const HINT_RULES = Object.freeze(' + JSON.stringify(bank.rules) + ');',
    'for (const value of Object.values(HINT_RULES)) if (value && typeof value === "object") Object.freeze(value);',
    'const catalog = [',
    ...phrases.map(hint => '  ' + JSON.stringify(hint) + ','),
    '];',
    'for (const hint of catalog) {',
    '  Object.freeze(hint.eligibleTiers);',
    '  Object.freeze(hint.matches);',
    '  Object.freeze(hint.possibleExtraMatches);',
    '  Object.freeze(hint);',
    '}',
    'export const STARTING_HINTS = Object.freeze(Object.fromEntries(',
    '  COUNTRIES.map(country => [country.code, Object.freeze(catalog.filter(hint =>',
    '    hint.matches.includes(country.code) && hint.eligibleTiers.some(tier => tier >= country.tier)',
    '  ))])',
    '));',
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidate = process.argv.includes('--candidate');
  const bank = await loadHintBank(ROOT, { candidate });
  let source = hintRuntimeSource(bank, { candidate });
  // The candidate lives two directories deeper than the game export.
  if (candidate) source = source.replace("from './data.js'", "from '../../data.js'");
  const output = join(ROOT, candidate ? 'research/starting-hints/candidate-hints.js' : 'starting-hints.js');
  await writeFile(output, source);
  console.log(candidate ? 'Candidate hints are ready for review.' : 'Exported reviewed hints for all 195 countries.');
}
