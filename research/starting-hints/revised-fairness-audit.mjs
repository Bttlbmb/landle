// Independent review tooling. This file does not change bank or game behavior.
// Supply the exact current content hash and generate its candidate first.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { COUNTRIES } from '../../data.js';

const TIERS = [1, 2, 3];
const letters = country => country.name.normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z]/gi, '').toUpperCase();
const vowel = letter => 'AEIOU'.includes(letter);
const namePredicates = {
  'name-first-a-m': country => letters(country)[0] <= 'M',
  'name-first-n-z': country => letters(country)[0] >= 'N',
  'name-last-a-m': country => letters(country).at(-1) <= 'M',
  'name-last-n-z': country => letters(country).at(-1) >= 'N',
  'name-over-six': country => letters(country).length > 6,
  'name-up-to-six': country => letters(country).length <= 6,
  'name-ends-vowel': country => vowel(letters(country).at(-1)),
  'name-ends-consonant': country => !vowel(letters(country).at(-1)),
  'name-vowel-consonant': country => vowel(letters(country)[0]) && !vowel(letters(country).at(-1)),
  'name-has-space': country => country.name.includes(' '),
  'name-no-e': country => !letters(country).includes('E'),
  'name-has-e': country => letters(country).includes('E'),
  'name-no-a': country => !letters(country).includes('A'),
  'name-has-o': country => letters(country).includes('O'),
};

const unique = values => [...new Set(values)];
const difference = (one, two) => one.filter(value => !two.includes(value));
const round = value => Number(value.toFixed(6));

export function independentGeneralPredicate(hint) {
  if (hint.family === 'name') {
    if (!namePredicates[hint.id]) throw new Error(`No independent name predicate for ${hint.id}`);
    return namePredicates[hint.id];
  }
  // Interpret the displayed numerical wording, not the bank's range/matches data.
  const field = hint.text.startsWith('Population ') ? 'population' : 'area';
  if (!['population', 'area'].includes(hint.family) || hint.family !== field) {
    throw new Error(`Unexpected numerical family for ${hint.id}`);
  }
  const multiplier = field === 'population' ? 1_000_000 : 1;
  const words = hint.text.replace(field === 'population' ? /^Population / : /^Land area /, '')
    .replace(/ million/g, '').replace(/ km²/g, '').replace(/\.$/, '');
  const number = text => Number(text.replace(/,/g, '')) * multiplier;
  let match;
  if ((match = /^below ([\d,]+)$/.exec(words))) return country => country[field] < number(match[1]);
  if ((match = /^of at least ([\d,]+)$/.exec(words))) return country => country[field] >= number(match[1]);
  if ((match = /^from ([\d,]+) to under ([\d,]+)$/.exec(words))) {
    return country => country[field] >= number(match[1]) && country[field] < number(match[2]);
  }
  throw new Error(`Unknown numerical wording for ${hint.id}: ${hint.text}`);
}

export function independentCatalog(bank) {
  const byCode = new Map(COUNTRIES.map(country => [country.code, country]));
  const generalDiscrepancies = [];
  const boundsDiscrepancies = [];
  const records = bank.catalog.map(hint => {
    const isGeneral = hint.kind === 'general' || hint.family !== 'geography';
    const matchingCodes = isGeneral
      ? COUNTRIES.filter(independentGeneralPredicate(hint)).map(country => country.code)
      : unique(hint.matches);
    const possibleCodes = unique([...matchingCodes, ...(hint.possibleExtraMatches ?? [])]);
    if (isGeneral && (difference(matchingCodes, hint.matches).length || difference(hint.matches, matchingCodes).length)) {
      generalDiscrepancies.push({ id: hint.id, missing: difference(matchingCodes, hint.matches), extra: difference(hint.matches, matchingCodes) });
    }
    const countCodes = (codes, tier) => codes.filter(code => byCode.get(code)?.tier <= tier).length;
    const counts = Object.fromEntries(TIERS.map(tier => [tier, countCodes(matchingCodes, tier)]));
    const maxima = Object.fromEntries(TIERS.map(tier => [tier, countCodes(possibleCodes, tier)]));
    for (const tier of TIERS) {
      if (counts[tier] !== hint.counts?.[tier] || maxima[tier] !== hint.maximumCounts?.[tier]) {
        boundsDiscrepancies.push({ id: hint.id, tier, computedCount: counts[tier], storedCount: hint.counts?.[tier], computedMaximum: maxima[tier], storedMaximum: hint.maximumCounts?.[tier] });
      }
    }
    return { ...hint, matchingCodes, possibleCodes, independentlyRecomputedCounts: counts, independentlyRecomputedMaximumCounts: maxima };
  });
  return { records, generalDiscrepancies, boundsDiscrepancies };
}

export function candidateMetrics(hint, availableCodes) {
  const available = new Set(availableCodes);
  const knownCount = hint.matchingCodes.filter(code => available.has(code)).length;
  const declaredMaximumCount = hint.possibleCodes.filter(code => available.has(code)).length;
  return { knownCount, declaredMaximumCount, availablePoolSize: available.size, declaredMaximumFraction: declaredMaximumCount / available.size };
}

export function representativeExclusionScenarios(catalog, poolCodes) {
  const scenarios = new Map([['', []]]);
  const add = codes => { const key = codes.slice().sort().join(','); scenarios.set(key, codes); };
  // Cover each clue's count/denominator boundary under up to three exclusions.
  // Membership in the verified, extra, or outside classes is sufficient to
  // explore count extrema. Runtime set equality is checked on each concrete set.
  for (const hint of catalog) {
    const known = new Set(hint.matchingCodes);
    const possible = new Set(hint.possibleCodes);
    const classes = [
      poolCodes.filter(code => known.has(code)),
      poolCodes.filter(code => possible.has(code) && !known.has(code)),
      poolCodes.filter(code => !possible.has(code)),
    ];
    for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3 - a; b++) for (let c = 0; c <= 3 - a - b; c++) {
      if (classes[0].length >= a && classes[1].length >= b && classes[2].length >= c) {
        add([...classes[0].slice(0, a), ...classes[1].slice(0, b), ...classes[2].slice(0, c)]);
      }
    }
  }
  // Explicitly retain the previously demonstrated history edge case.
  if (['GR', 'IT', 'PT'].every(code => poolCodes.includes(code))) add(['GR', 'IT', 'PT']);
  return [...scenarios.values()];
}

export function summarizeWeightedSelection(rows, poolSize) {
  const totals = new Map();
  const dimensions = new Map();
  const phrases = new Map();
  for (const row of rows) {
    totals.set(row.family, (totals.get(row.family) ?? 0) + row.probability);
    dimensions.set(row.dimension, (dimensions.get(row.dimension) ?? 0) + row.probability);
    const old = phrases.get(row.id) ?? { id: row.id, text: row.text, probability: 0, targets: [] };
    old.probability += row.probability;
    old.targets.push(row.code);
    phrases.set(row.id, old);
  }
  return {
    poolSize,
    familyProbabilities: Object.fromEntries([...totals].map(([key, value]) => [key, round(value)])),
    dimensionProbabilities: Object.fromEntries([...dimensions].map(([key, value]) => [key, round(value)])),
    phrases: [...phrases.values()].map(row => ({ ...row, probability: round(row.probability), displayCapableTargets: row.targets.length })).sort((a, b) => b.probability - a.probability),
  };
}

export function readBankForReadyAudit(expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) {
    throw new Error('Supply the exact current bank content hash.');
  }
  const bank = JSON.parse(fs.readFileSync(new URL('../../starting-hints.json', import.meta.url), 'utf8'));
  const digest = crypto.createHash('sha256').update(JSON.stringify({ rules: bank.rules, catalog: bank.catalog, countries: bank.countries })).digest('hex');
  if (digest !== expectedHash || bank.contentSha256 !== expectedHash) throw new Error('Expected revised bank hash does not match current content.');
  return { bank, digest };
}

export async function auditReadyRuntime(expectedHash, { seedsPerCountry = 1024 } = {}) {
  const { bank, digest } = readBankForReadyAudit(expectedHash);
  const geography = await import('./candidate-selection.js');
  const exported = await import('./candidate-hints.js');
  if (typeof geography.chooseOpeningHint !== 'function') throw new Error('Revised chooseOpeningHint API is missing.');
  if (exported.HINT_BANK_VERSION !== digest) throw new Error('Runtime export does not match the revised bank hash.');
  const independent = independentCatalog(bank);
  const catalog = independent.records;
  const byHint = new Map(catalog.map(hint => [hint.id, hint]));
  const issues = [];
  const poolSummaries = [];
  const count = values => values.reduce((sum, value) => sum + value, 0);
  if (bank.rules.minimumMatches !== 4
    || JSON.stringify(bank.rules.minimumPossibleMatches) !== JSON.stringify({ 1: 4, 2: 7, 3: 7 })
    || bank.rules.maximumFraction !== 0.7) {
    issues.push({ kind: 'reviewed bounds policy', rules: bank.rules });
  }
  const gateFor = (hint, tier, availableCodes) => {
    const m = candidateMetrics(hint, availableCodes);
    // A partial list can still have a complete possible union of six answers.
    // Require a sufficiently broad possible union as well as confirmed facts.
    const minimumPossible = tier > 1 ? 7 : 4;
    return m.knownCount >= 4 && m.declaredMaximumCount >= minimumPossible && m.declaredMaximumFraction <= 0.7;
  };
  const expectedIds = (country, tier, availableCodes) => catalog.filter(hint =>
    hint.matchingCodes.includes(country.code) && gateFor(hint, tier, COUNTRIES.filter(item => item.tier <= tier).map(item => item.code)) && gateFor(hint, tier, availableCodes)
  ).map(hint => hint.id).sort();
  const expectedTierEligibility = hint => TIERS.filter(tier => gateFor(hint, tier, COUNTRIES.filter(country => country.tier <= tier).map(country => country.code)));
  for (const hint of catalog) {
    if (JSON.stringify(expectedTierEligibility(hint)) !== JSON.stringify(hint.eligibleTiers)) {
      issues.push({ kind: 'catalog eligibility', id: hint.id, expected: expectedTierEligibility(hint), actual: hint.eligibleTiers });
    }
  }
  for (const country of COUNTRIES) {
    const entry = bank.countries.find(item => item.code === country.code);
    if (!entry || entry.hints?.length !== 4 || new Set(entry.hints).size !== 4) issues.push({ kind: 'four concise examples', code: country.code });
    const expectedAlternatives = catalog.filter(hint => hint.matchingCodes.includes(country.code) && hint.eligibleTiers.some(tier => tier >= country.tier)).map(hint => hint.id).sort();
    const actualAlternatives = [...(entry?.alternatives ?? [])].sort();
    if (JSON.stringify(expectedAlternatives) !== JSON.stringify(actualAlternatives)) {
      issues.push({ kind: 'all reviewed true alternatives', code: country.code, missing: difference(expectedAlternatives, actualAlternatives), extra: difference(actualAlternatives, expectedAlternatives) });
    }
    const exportedIds = exported.STARTING_HINTS[country.code]?.map(hint => hint.id).sort() ?? [];
    if (JSON.stringify(exportedIds) !== JSON.stringify(actualAlternatives)) issues.push({ kind: 'alternative export projection', code: country.code });
  }
  let exclusionScenarioCount = 0;
  let excludedTargetChecks = 0;
  const effectiveCompleteSmallCases = [];
  const permittedPartialSmallCases = [];
  for (const tier of TIERS) {
    const pool = COUNTRIES.filter(country => country.tier <= tier);
    const codes = pool.map(country => country.code);
    const support = new Map();
    const sampleTotals = { name: 0, numeric: 0, geography: 0 };
    const weightedRows = [];
    const perCountry = [];
    for (const country of pool) {
      const choices = geography.openingHintsFor(country, tier, []);
      const ids = choices.map(hint => hint.id).sort();
      const expected = expectedIds(country, tier, codes);
      if (JSON.stringify(ids) !== JSON.stringify(expected)) issues.push({ kind: 'full-pool candidates', tier, code: country.code, missing: difference(expected, ids), extra: difference(ids, expected) });
      const buckets = {
        name: choices.filter(hint => hint.family === 'name'),
        numeric: choices.filter(hint => ['population', 'area'].includes(hint.family)),
        geography: choices.filter(hint => hint.family === 'geography'),
      };
      if (Object.values(buckets).some(bucket => bucket.length === 0)) issues.push({ kind: 'missing family bucket', tier, code: country.code, bucketSizes: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])) });
      for (const [family, bucket] of Object.entries(buckets)) {
        const weight = family === 'geography' ? 0.5 : 0.25;
        for (const hint of bucket) weightedRows.push({ code: country.code, id: hint.id, text: hint.text, family: hint.family, dimension: byHint.get(hint.id)?.dimension, probability: weight / bucket.length / pool.length });
      }
      for (const hint of choices) {
        support.set(hint.id, (support.get(hint.id) ?? 0) + 1);
        if (!byHint.get(hint.id)?.matchingCodes.includes(country.code)) issues.push({ kind: 'unconfirmed target fact', tier, code: country.code, id: hint.id });
      }
      const reached = new Set();
      const frequency = new Map();
      for (let seedIndex = 0; seedIndex < seedsPerCountry; seedIndex++) {
        const seed = `fairness-${tier}-${country.code}-${seedIndex}`;
        const selected = geography.chooseOpeningHint(country, seed, tier, []);
        if (!ids.includes(selected.id)) issues.push({ kind: 'selected ineligible fact', tier, code: country.code, seed, id: selected.id });
        if (seedIndex < 8) {
          if (geography.openingHint(country, seed, tier, []) !== selected.text) issues.push({ kind: 'object/text API disagreement', tier, code: country.code, seed });
          if (geography.chooseOpeningHint({ code: country.code }, seed, tier, []).id !== selected.id) issues.push({ kind: 'country-copy instability', tier, code: country.code, seed });
        }
        reached.add(selected.id);
        frequency.set(selected.id, (frequency.get(selected.id) ?? 0) + 1);
        const family = selected.family === 'name' ? 'name' : selected.family === 'geography' ? 'geography' : 'numeric';
        sampleTotals[family]++;
      }
      if (difference(ids, [...reached]).length) issues.push({ kind: 'advertised alternative not reached', tier, code: country.code, missing: difference(ids, [...reached]) });
      perCountry.push({ code: country.code, name: country.name, candidateFacts: ids.length, bucketSizes: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])), seedCount: seedsPerCountry, reachedFactCount: reached.size, sampledFactCounts: Object.fromEntries(frequency) });
    }
    const phraseSupport = [...support].map(([id, targetCount]) => ({ id, text: byHint.get(id).text, targetCount, ...candidateMetrics(byHint.get(id), codes) }));
    for (const hint of catalog.filter(hint => gateFor(hint, tier, codes))) {
      const expectedSupport = hint.matchingCodes.filter(code => codes.includes(code)).length;
      const actualSupport = support.get(hint.id) ?? 0;
      if (expectedSupport !== actualSupport) issues.push({ kind: 'display support below verified membership', tier, id: hint.id, expectedSupport, actualSupport });
    }
    const scenarios = representativeExclusionScenarios(catalog, codes);
    for (const excluded of scenarios) {
      if (!excluded.length) continue;
      const excludedSet = new Set(excluded);
      const available = codes.filter(code => !excludedSet.has(code));
      const fullIds = new Set(catalog.filter(hint => gateFor(hint, tier, codes)).map(hint => hint.id));
      const revisedIds = new Set(catalog.filter(hint => fullIds.has(hint.id) && gateFor(hint, tier, available)).map(hint => hint.id));
      const changed = catalog.filter(hint => fullIds.has(hint.id) !== revisedIds.has(hint.id));
      const affectedCodes = unique(changed.flatMap(hint => hint.matchingCodes.filter(code => available.includes(code))));
      const selectedCodes = unique([...affectedCodes, ...available.slice(0, 3), ...available.slice(-3)]);
      exclusionScenarioCount++;
      for (const hint of catalog.filter(hint => fullIds.has(hint.id) && gateFor(hint, tier, available))) {
        const m = candidateMetrics(hint, available);
        if (tier > 1 && m.knownCount <= 6 && m.knownCount === m.declaredMaximumCount) {
          effectiveCompleteSmallCases.push({ tier, id: hint.id, excluded, ...m });
        } else if (tier > 1 && m.knownCount <= 6 && m.knownCount < m.declaredMaximumCount) {
          permittedPartialSmallCases.push({ tier, id: hint.id, excluded, ...m });
        }
      }
      for (const code of selectedCodes) {
        const country = pool.find(country => country.code === code);
        const actual = geography.openingHintsFor(country, tier, excluded).map(hint => hint.id).sort();
        const expected = expectedIds(country, tier, available);
        excludedTargetChecks++;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push({ kind: 'excluded-pool candidates', tier, code, excluded, missing: difference(expected, actual), extra: difference(actual, expected) });
        if (!actual.length) issues.push({ kind: 'no hint after exclusions', tier, code, excluded });
      }
    }
    const sampledDraws = count(Object.values(sampleTotals));
    poolSummaries.push({ tier, poolSize: pool.length, catalogEligiblePhrases: phraseSupport.length, displaySingletons: phraseSupport.filter(row => row.targetCount === 1), minimumDisplaySupport: Math.min(...phraseSupport.map(row => row.targetCount)), phraseSupport, weightedSelection: summarizeWeightedSelection(weightedRows, pool.length), sample: { seedsPerCountry, totalDraws: sampledDraws, familyCounts: sampleTotals, familyFractions: Object.fromEntries(Object.entries(sampleTotals).map(([key, value]) => [key, round(value / sampledDraws)])) }, exclusionScenarios: scenarios.length - 1, perCountry });
  }
  const effectivePossibleSmallCases = [...effectiveCompleteSmallCases, ...permittedPartialSmallCases].filter(row => row.declaredMaximumCount <= 6);
  return { contentSha256: digest, generatedAt: new Date().toISOString(), status: 'raw independent audit; no editorial verdict', generalMembershipDiscrepancies: independent.generalDiscrepancies, boundsDiscrepancies: independent.boundsDiscrepancies, issues, effectiveCompleteSmallCases, effectivePossibleSmallCases, permittedPartialSmallCases, exclusionScenarioCount, excludedTargetChecks, poolSummaries };
}

if (process.argv.includes('--run')) {
  const flagIndex = process.argv.indexOf('--expected-hash');
  const expectedHash = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  const raw = await auditReadyRuntime(expectedHash);
  const output = new URL('./revised-fairness-audit-results.json.gz', import.meta.url);
  fs.writeFileSync(output, gzipSync(JSON.stringify(raw, null, 2) + '\n'));
  console.log(JSON.stringify({ contentSha256: raw.contentSha256, issues: raw.issues.length, generalMembershipDiscrepancies: raw.generalMembershipDiscrepancies.length, boundsDiscrepancies: raw.boundsDiscrepancies.length, effectiveCompleteSmallCases: raw.effectiveCompleteSmallCases.length, effectivePossibleSmallCases: raw.effectivePossibleSmallCases.length, permittedPartialSmallCases: raw.permittedPartialSmallCases.length, exclusionScenarioCount: raw.exclusionScenarioCount, excludedTargetChecks: raw.excludedTargetChecks, tiers: raw.poolSummaries.map(tier => ({ tier: tier.tier, selectablePhrases: tier.catalogEligiblePhrases, displaySingletons: tier.displaySingletons.length, minimumDisplaySupport: tier.minimumDisplaySupport, sampledFamilyFractions: tier.sample.familyFractions })) }, null, 2));
}
