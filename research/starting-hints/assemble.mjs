import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { COUNTRIES, POPULATION_YEAR, AREA_YEAR } from '../../data.js';

const root = new URL('./', import.meta.url);
const pools = [null, ...[1, 2, 3].map(tier => COUNTRIES.filter(country => country.tier <= tier))];
const countriesByCode = new Map(COUNTRIES.map(country => [country.code, country]));
const nameSource = 'https://github.com/mledoze/countries';
const populationSource = 'https://data.worldbank.org/indicator/SP.POP.TOTL';
const areaSource = 'https://data.worldbank.org/indicator/AG.LND.TOTL.K2';
const vaticanPopulationSource = 'https://www.vaticanstate.va/en/state-and-government/general-informations/population.html';
const vaticanAreaSource = 'https://www.vaticanstate.va/en/state-and-government/general-informations/geography.html';
const canonical = country => country.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
const letters = country => canonical(country).replace(/[^A-Z]/g, '');
const vowel = letter => 'AEIOU'.includes(letter);
const rules = {
  minimumMatches: 4, minimumPossibleMatches: { 1: 4, 2: 7, 3: 7 },
  maximumFraction: 0.7, pools: { 1: 45, 2: 110, 3: 195 }, hintsPerCountry: 4,
  selection: 'all-reviewed-alternatives', familyWeights: { name: 0.25, numeric: 0.25, geography: 0.5 },
};

function eligibleTiers(hint) {
  return [1, 2, 3].filter(tier => {
    return hint.counts[tier] >= rules.minimumMatches
      && hint.maximumCounts[tier] >= rules.minimumPossibleMatches[tier]
      && hint.maximumCounts[tier] <= rules.maximumFraction * pools[tier].length;
  });
}

function makeHint(id, text, family, matches, sources, extra = {}) {
  const codes = COUNTRIES.filter(matches).map(country => country.code);
  const counts = Object.fromEntries([1, 2, 3].map(tier => [tier, pools[tier].filter(country => codes.includes(country.code)).length]));
  const hint = { id, text, family, kind: 'general', dimension: family, matches: codes, counts, maximumCounts: { ...counts }, possibleExtraMatches: [], sources, notes: [], ...extra };
  return { ...hint, eligibleTiers: eligibleTiers(hint) };
}

const nameHints = [
  ['first-a-m', 'First letter is from A to M.', country => letters(country)[0] <= 'M'],
  ['first-n-z', 'First letter comes after M.', country => letters(country)[0] > 'M'],
  ['last-a-m', 'The name ends with a letter from A to M.', country => letters(country).at(-1) <= 'M'],
  ['last-n-z', 'The name ends with a letter from N to Z.', country => letters(country).at(-1) > 'M'],
  ['over-six', 'The name has more than six letters.', country => letters(country).length > 6],
  ['up-to-six', 'The name has six letters or fewer.', country => letters(country).length <= 6],
  ['ends-vowel', 'The name ends with a vowel.', country => vowel(letters(country).at(-1))],
  ['ends-consonant', 'The name ends with a consonant.', country => !vowel(letters(country).at(-1))],
  ['vowel-consonant', 'The name starts with a vowel and ends with a consonant.', country => vowel(letters(country)[0]) && !vowel(letters(country).at(-1))],
  ['starts-consonant', 'The name starts with a consonant.', country => !vowel(letters(country)[0])],
  ['has-space', 'The name contains a space.', country => country.name.includes(' ')],
  ['no-e', 'The name contains no E.', country => !letters(country).includes('E')],
  ['has-e', 'The name contains E.', country => letters(country).includes('E')],
  ['no-a', 'The name contains no A.', country => !letters(country).includes('A')],
  ['has-o', 'The name contains O.', country => letters(country).includes('O')],
].map(([id, text, matches]) => makeHint(`name-${id}`, text, 'name', matches, [nameSource], {
  notes: ['Use the displayed English name. Ignore accents, spaces and hyphens when counting letters. Vowels are A, E, I, O and U.'],
}));

function numericHints(field, family, edges, unit, sources, year) {
  return edges.slice(0, -1).map((low, index) => {
    const high = edges[index + 1];
    const display = number => field === 'population' ? `${number / 1_000_000} million` : number.toLocaleString('en-US');
    const subject = field === 'population' ? 'Population' : 'Land area';
    const text = low === 0 ? `${subject} below ${display(high)}${unit}.`
      : high === Infinity ? `${subject} of at least ${display(low)}${unit}.`
        : `${subject} from ${display(low)} to under ${display(high)}${unit}.`;
    return makeHint(`${family}-${low}-${high === Infinity ? 'plus' : high}`, text, family,
      country => country[field] >= low && country[field] < high,
      low === 0 ? [...sources, field === 'population' ? vaticanPopulationSource : vaticanAreaSource] : sources,
      { notes: [`Uses the embedded ${year} snapshot${field === 'area' ? '; inland water is excluded' : ''}.`, ...(low === 0 ? ['Vatican City uses its official population and geography publications.'] : [])], range: { field, low, high: high === Infinity ? null : high } });
  });
}

const generalCatalog = [
  ...nameHints,
  ...numericHints('population', 'population', [0, 1_000_000, 10_000_000, 50_000_000, 150_000_000, Infinity], '', [populationSource], POPULATION_YEAR),
  ...numericHints('area', 'area', [0, 10_000, 100_000, 500_000, 1_500_000, Infinity], ' km²', [areaSource], AREA_YEAR),
].filter(hint => hint.eligibleTiers.length);
// Geography is required: a missing source must not silently produce an incomplete bank.
const geography = JSON.parse(await readFile(new URL('geography.json', root), 'utf8'));

const specificCatalog = geography.factGroups.filter(group => group.displaySafe !== false).map(group => {
  const codes = new Set(group.codes);
  for (const code of codes) if (!countriesByCode.has(code)) throw new Error(`Unknown match ${code} in ${group.id}`);
  const candidate = makeHint(`geo-${group.id}`, group.text, 'geography', country => codes.has(country.code), group.sources, {
    kind: 'specific', dimension: group.dimension || 'geography', notes: group.notes || [], ...(group.rule ? { rule: group.rule } : {}),
  });
  const uncertain = group.dimension === 'borders' || group.dimension === 'neighbour-location'
    ? geography.records.filter(record => !record.borderCountAllowed).map(record => record.code)
    : group.dimension === 'neighbour-area'
      ? geography.records.filter(record => !record.neighbourAreaAllowed).map(record => record.code)
      : group.possibleExtraCodes || [];
  candidate.possibleExtraMatches = [...new Set(uncertain)].filter(code => countriesByCode.has(code) && !codes.has(code));
  const possible = new Set([...candidate.matches, ...candidate.possibleExtraMatches]);
  candidate.maximumCounts = Object.fromEntries([1, 2, 3].map(tier => [tier, pools[tier].filter(country => possible.has(country.code)).length]));
  candidate.eligibleTiers = eligibleTiers(candidate);
  return candidate;
}).filter(hint => hint.eligibleTiers.length);

const catalog = [...generalCatalog, ...specificCatalog];
if (new Set(catalog.map(hint => hint.id)).size !== catalog.length) throw new Error('Duplicate hint ids.');
const unresolved = [];
const exampleUsage = [null, new Map(), new Map(), new Map()];
const coverageByCode = new Map();
for (const country of COUNTRIES.toSorted((a, b) => a.tier - b.tier || a.code.localeCompare(b.code))) {
  const alternatives = catalog.filter(hint => hint.matches.includes(country.code)
    && hint.eligibleTiers.some(tier => tier >= country.tier));
  const usable = alternatives.filter(hint => hint.eligibleTiers.includes(country.tier));
  const usage = exampleUsage[country.tier];
  const score = hint => {
    const fraction = hint.counts[country.tier] / pools[country.tier].length;
    const sharpFact = hint.id === 'geo-all-smaller-land-neighbours' ? 14 : 0;
    const shortList = hint.counts[country.tier] === hint.maximumCounts[country.tier] && hint.counts[country.tier] <= 6 ? 12 : 0;
    return 100 + sharpFact - shortList - Math.abs(fraction - (hint.family === 'geography' ? 0.3 : 0.4)) * 30
      - (usage.get(hint.id) || 0) * 8;
  };
  const best = items => items.toSorted((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
  const chosenName = best(usable.filter(hint => hint.family === 'name'));
  const chosenNumber = best(usable.filter(hint => hint.family === 'population' || hint.family === 'area'));
  const geographyChoices = usable.filter(hint => hint.family === 'geography');
  let chosenSpecific = [];
  let bestPairScore = -Infinity;
  for (let first = 0; first < geographyChoices.length; first++) {
    for (let second = first + 1; second < geographyChoices.length; second++) {
      const pair = [geographyChoices[first], geographyChoices[second]];
      const sets = pair.map(hint => new Set(hint.matches));
      const overlap = [...sets[0]].filter(code => sets[1].has(code)).length;
      const nested = overlap === Math.min(sets[0].size, sets[1].size);
      if (nested) continue;
      const jaccard = overlap / (sets[0].size + sets[1].size - overlap);
      const pairScore = pair.reduce((sum, hint) => sum + score(hint), 0)
        - (pair[0].dimension === pair[1].dimension ? 25 : 0) - jaccard * 35;
      if (pairScore > bestPairScore) { bestPairScore = pairScore; chosenSpecific = pair; }
    }
  }
  const chosen = [chosenName, chosenNumber, ...chosenSpecific].filter(Boolean);
  if (chosen.length !== rules.hintsPerCountry) unresolved.push({ code: country.code, name: country.name, availableFacts: usable.length, geographyChoices: geographyChoices.map(hint => hint.id) });
  for (const hint of chosen) usage.set(hint.id, (usage.get(hint.id) || 0) + 1);
  coverageByCode.set(country.code, { code: country.code, name: country.name, tier: country.tier,
    hints: chosen.map(hint => hint.id), alternatives: alternatives.map(hint => hint.id) });
}
const coverage = COUNTRIES.map(country => coverageByCode.get(country.code));

// Compression retains the exact source bytes and the original snapshot hash.
const sourceBytes = gunzipSync(await readFile(new URL('upstream-countries.json.gz', root)));
const bank = {
  version: 2,
  assembled: '2026-10-04',
  status: 'awaiting-independent-review',
  rules,
  selectionNotes: 'Four concise examples per country; gameplay selects from every reviewed eligible alternative. Availability is rechecked against the saved round exclusions. Every Medium/Hard hint must leave at least seven declared possible answers, including conservative extras, and at least four confirmed matches. A partial positive list is not an exhaustive shortlist.',
  nameConvention: 'Use the displayed English country name; accents do not change letter identity, spaces/hyphens are not letters, and vowels are A/E/I/O/U.',
  attribution: [
    { source: 'mledoze/countries contributors', license: 'ODbL-1.0', url: nameSource, localLicense: 'DATA_LICENSE.txt' },
    { source: 'World Bank, World Development Indicators', license: 'CC-BY-4.0', populationYear: POPULATION_YEAR, landAreaYear: AREA_YEAR },
    { source: 'Vatican City official population and geography publications; additional official and UN geography sources are cited per clue.' },
  ],
  sourceSnapshot: { url: 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json', sha256: createHash('sha256').update(sourceBytes).digest('hex') },
  sourceAlternatives: {
    'https://www.information.gov.bn/PublishingImages/SitePages/Publication%20Lists/Brunei%20District.pdf': 'https://www.mfa.gov.bn/taipei/SitePages/visitbrunei.aspx',
  },
  catalog,
  countries: coverage,
  unresolved,
};
bank.contentSha256 = createHash('sha256').update(JSON.stringify({ rules: bank.rules, catalog: bank.catalog, countries: bank.countries })).digest('hex');
const reviewFiles = ['revised-accuracy-review.json', 'revised-fairness-review.json'];
const reviews = [];
for (const file of reviewFiles) {
  try {
    const review = JSON.parse(await readFile(new URL(file, root), 'utf8'));
    if (review.status === 'passed' && review.reviewedContentSha256 === bank.contentSha256) reviews.push({ file, reviewer: review.reviewer, reviewedContentSha256: review.reviewedContentSha256 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (reviews.length === 2 && !unresolved.length) { bank.status = 'reviewed'; bank.reviews = reviews; }
await writeFile(new URL('../../starting-hints.json', root), JSON.stringify(bank, null, 2) + '\n');
console.log(JSON.stringify({ countries: coverage.length, examples: coverage.reduce((sum, country) => sum + country.hints.length, 0), alternatives: coverage.reduce((sum, country) => sum + country.alternatives.length, 0), generalPhrases: generalCatalog.length, specificPhrases: specificCatalog.length, unresolved, contentSha256: bank.contentSha256 }));
