import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COUNTRIES, POPULATION_YEAR, AREA_YEAR } from '../data.js';
import { STARTING_HINTS, HINT_BANK_VERSION, HINT_RULES } from '../starting-hints.js';
import {
  distanceKm, initialBearing, compassDirection, directionName, distanceBand,
  clueFor, countriesForTier, findCountry, normalizeCountryName, openingHint, openingHintsFor, chooseOpeningHint,
} from '../geography.js';

const point = (lat, lon) => ({ lat, lon });
const hintBank = JSON.parse(await readFile(new URL('../starting-hints.json', import.meta.url), 'utf8'));
const reviewedHints = new Map(hintBank.catalog.map(hint => [hint.id, hint]));
const hintAssignment = hint => ({ id: hint.id, text: hint.text, family: hint.family, dimension: hint.dimension,
  eligibleTiers: hint.eligibleTiers, matches: hint.matches, possibleExtraMatches: hint.possibleExtraMatches });

// Read the displayed name/numerical wording independently of its catalog rule.
function generalHintFact(text) {
  const letters = country => country.name.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z]/g, '');
  const isVowel = letter => /^[AEIOU]$/.test(letter);
  const nameFacts = {
    'First letter is from A to M.': country => /^[A-M]/.test(letters(country)),
    'First letter comes after M.': country => /^[N-Z]/.test(letters(country)),
    'The name ends with a letter from A to M.': country => /[A-M]$/.test(letters(country)),
    'The name ends with a letter from N to Z.': country => /[N-Z]$/.test(letters(country)),
    'The name has more than six letters.': country => letters(country).length > 6,
    'The name has six letters or fewer.': country => letters(country).length <= 6,
    'The name ends with a vowel.': country => isVowel(letters(country).at(-1)),
    'The name ends with a consonant.': country => !isVowel(letters(country).at(-1)),
    'The name starts with a vowel and ends with a consonant.': country => isVowel(letters(country)[0]) && !isVowel(letters(country).at(-1)),
    'The name contains a space.': country => country.name.includes(' '),
    'The name contains no E.': country => !letters(country).includes('E'),
    'The name contains E.': country => letters(country).includes('E'),
    'The name contains no A.': country => !letters(country).includes('A'),
    'The name contains O.': country => letters(country).includes('O'),
  };
  if (nameFacts[text]) return { family: 'name', matches: nameFacts[text] };
  const population = text.startsWith('Population ');
  const family = population ? 'population' : 'area';
  const wording = text.replace(population ? /^Population / : /^Land area /, '')
    .replace(population ? / million/g : / km²/g, '').replace(/\.$/, '');
  const value = number => Number(number.replace(/,/g, '')) * (population ? 1_000_000 : 1);
  let range;
  if ((range = /^below ([\d,]+)$/.exec(wording))) {
    return { family, matches: country => country[family] < value(range[1]) };
  }
  if ((range = /^of at least ([\d,]+)$/.exec(wording))) {
    return { family, matches: country => country[family] >= value(range[1]) };
  }
  if ((range = /^from ([\d,]+) to under ([\d,]+)$/.exec(wording))) {
    return { family, matches: country => country[family] >= value(range[1]) && country[family] < value(range[2]) };
  }
  assert.fail(`Unknown general hint: ${text}`);
}

const seededHints = (country, tier = country.tier, excluded = []) => Array.from({ length: 1024 }, (_, index) => openingHint(country, `round-${index}`, tier, excluded));

function independentEligible(hint, tier, pool) {
  if (!hint.eligibleTiers.includes(tier)) return false;
  const confirmed = pool.filter(country => hint.matches.includes(country.code)).length;
  const maximum = pool.filter(country => [...hint.matches, ...hint.possibleExtraMatches].includes(country.code)).length;
  return confirmed >= HINT_RULES.minimumMatches && maximum >= HINT_RULES.minimumPossibleMatches[tier]
    && maximum / pool.length <= HINT_RULES.maximumFraction;
}

test('runtime assignments exactly match the reviewed bank and content hash', () => {
  assert.equal(hintBank.status, 'reviewed');
  assert.deepEqual(hintBank.unresolved, []);
  const digest = createHash('sha256').update(JSON.stringify({ rules: hintBank.rules, catalog: hintBank.catalog, countries: hintBank.countries })).digest('hex');
  assert.equal(digest, hintBank.contentSha256);
  assert.equal(HINT_BANK_VERSION, digest);
  assert.equal(hintBank.reviews.length, 2);
  for (const review of hintBank.reviews) assert.equal(review.reviewedContentSha256, digest);
  assert.deepEqual(HINT_RULES, hintBank.rules);
  assert.equal(HINT_RULES.minimumMatches, 4);
  assert.deepEqual(HINT_RULES.minimumPossibleMatches, { 1: 4, 2: 7, 3: 7 });
  assert.equal(HINT_RULES.maximumFraction, 0.7);
  assert.deepEqual(HINT_RULES.pools, { 1: 45, 2: 111, 3: 196 });
  assert.deepEqual(Object.keys(STARTING_HINTS).sort(), COUNTRIES.map(country => country.code).sort());
  assert.equal(hintBank.countries.length, 196);
  for (const country of hintBank.countries) {
    assert.deepEqual(STARTING_HINTS[country.code], country.alternatives.map(id => hintAssignment(reviewedHints.get(id))), country.name);
  }
});

test('name, population and area hints independently agree with displayed English names and data', () => {
  for (const hint of hintBank.catalog.filter(hint => hint.family !== 'geography')) {
    const fact = generalHintFact(hint.text);
    assert.equal(fact.family, hint.family, hint.text);
    assert.deepEqual(COUNTRIES.filter(fact.matches).map(country => country.code), hint.matches, hint.text);
  }
});

test('every opening hint is confirmed, within the breadth cap, and avoids six-answer Medium/Hard groups', () => {
  for (const tier of [1, 2, 3]) {
    const pool = countriesForTier(tier);
    assert.equal(pool.length, HINT_RULES.pools[tier]);
    for (const country of pool) {
      const choices = openingHintsFor(country, tier);
      assert.deepEqual(choices, STARTING_HINTS[country.code].filter(hint => hint.eligibleTiers.includes(tier)), `${country.name}, tier ${tier}`);
      assert.ok(choices.length >= 4, `${country.name}, tier ${tier}`);
      for (const hint of choices) {
        const reviewed = reviewedHints.get(hint.id);
        assert.ok(reviewed.matches.includes(country.code), `${country.name}: ${hint.text}`);
        const escapedName = country.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.equal(new RegExp(`(?<!\\p{L})${escapedName}(?!\\p{L})`, 'u').test(hint.text), false, `${country.name}: ${hint.text}`);
        const confirmed = new Set(reviewed.matches);
        const possible = new Set([...reviewed.matches, ...reviewed.possibleExtraMatches]);
        const count = pool.filter(country => confirmed.has(country.code)).length;
        const maximum = pool.filter(country => possible.has(country.code)).length;
        assert.equal(count, reviewed.counts[tier], hint.id);
        assert.equal(maximum, reviewed.maximumCounts[tier], hint.id);
        assert.ok(count >= HINT_RULES.minimumMatches, `${hint.id}, tier ${tier}: ${count} confirmed answers`);
        assert.ok(maximum >= HINT_RULES.minimumPossibleMatches[tier], `${hint.id}, tier ${tier}: at most ${maximum} possible answers`);
        assert.ok(maximum / pool.length <= HINT_RULES.maximumFraction, `${hint.id}, tier ${tier}: up to ${maximum} possible answers`);
      }
    }
  }
});

test('all 196 countries have four varied examples and seeds can reach every reviewed runtime alternative', () => {
  for (const country of COUNTRIES) {
    const entry = hintBank.countries.find(item => item.code === country.code);
    const examples = entry.hints.map(id => reviewedHints.get(id));
    const choices = openingHintsFor(country);
    assert.equal(new Set(examples.map(hint => hint.id)).size, 4, country.name);
    assert.equal(examples.filter(hint => hint.family === 'name').length, 1, country.name);
    assert.equal(examples.filter(hint => ['population', 'area'].includes(hint.family)).length, 1, country.name);
    assert.equal(examples.filter(hint => hint.family === 'geography').length, 2, country.name);
    assert.equal(new Set(examples.filter(hint => hint.family === 'geography').map(hint => hint.dimension)).size, 2, country.name);
    assert.ok(examples.every(hint => choices.some(choice => choice.id === hint.id)), country.name);
    const geographyExamples = examples.filter(hint => hint.family === 'geography');
    assert.ok(geographyExamples.every((hint, index) => hint.matches.some(code => !geographyExamples[1 - index].matches.includes(code))), country.name);
    for (let tier = country.tier; tier <= 3; tier++) {
      assert.deepEqual(new Set(seededHints(country, tier)), new Set(openingHintsFor(country, tier).map(hint => hint.text)), `${country.name}, tier ${tier}`);
    }
  }
});

test('explicit round tier filters approved choices instead of using the country default', () => {
  const afghanistan = findCountry('Afghanistan');
  assert.equal(afghanistan.tier, 2);
  assert.throws(() => openingHintsFor(afghanistan, 1), RangeError, 'The target must belong to the actual answer pool');
  const japan = findCountry('Japan');
  assert.ok(openingHintsFor(japan, 1).some(hint => hint.id === 'geo-island-country-asia'));
  assert.ok(!openingHintsFor(japan, 2).some(hint => hint.id === 'geo-island-country-asia'), 'The five-answer Medium group is too short even though the Easy group is allowed');
  assert.notDeepEqual(openingHintsFor(japan, 1), openingHintsFor(japan, 2));
  assert.deepEqual(openingHintsFor(afghanistan, 2), STARTING_HINTS.AF.filter(hint => hint.eligibleTiers.includes(2)));
  assert.deepEqual(openingHintsFor({ code: 'AF' }, 2), openingHintsFor(afghanistan, 2));
});

test('previous-answer exclusions cannot turn a starter hint into a one-answer or six-answer clue', () => {
  const cases = [
    { code: 'ES', tier: 1, excluded: ['GR', 'IT', 'PT'], forbidden: 'geo-un-location-southern-europe' },
    { code: 'NL', tier: 2, excluded: ['SE', 'FR', 'GB'], forbidden: 'geo-north-sea-coast' },
    { code: 'NL', tier: 3, excluded: ['FR', 'BE'], forbidden: 'geo-north-sea-coast' },
  ];
  for (const { code, tier, excluded, forbidden } of cases) {
    const country = findCountry(code);
    assert.ok(openingHintsFor(country, tier).some(hint => hint.id === forbidden), forbidden);
    const pool = countriesForTier(tier).filter(item => !excluded.includes(item.code));
    const choices = openingHintsFor(country, tier, excluded);
    assert.deepEqual(choices, STARTING_HINTS[code].filter(hint => independentEligible(hint, tier, pool)));
    assert.ok(!choices.some(hint => hint.id === forbidden), forbidden);
    assert.deepEqual(new Set(seededHints(country, tier, excluded)), new Set(choices.map(hint => hint.text)));
  }
});

test('neighbour-size membership includes previously omitted positives and conservative scopes affect breadth', () => {
  const smaller = reviewedHints.get('geo-all-smaller-land-neighbours');
  for (const code of ['ID', 'IR', 'SA', 'BR', 'RU']) assert.ok(smaller.matches.includes(code), code);
  const larger = reviewedHints.get('geo-all-larger-land-neighbours');
  for (const code of ['AD', 'BT', 'MN', 'NP', 'PT']) assert.ok(larger.matches.includes(code), code);
  assert.equal(larger.matches.includes('SR'), false, 'French Guiana vs sovereign France can reverse this comparison');
  assert.ok(larger.possibleExtraMatches.includes('SR'));
  const mixed = reviewedHints.get('geo-smaller-and-larger-land-neighbours');
  for (const code of ['CA', 'DE', 'IT']) assert.ok(mixed.matches.includes(code), code);
  assert.deepEqual(reviewedHints.get('geo-at-least-one-smaller-land-neighbour').eligibleTiers, [3]);
  assert.equal(reviewedHints.has('geo-at-least-one-larger-land-neighbour'), false, 'Its possible breadth exceeds the cap at every difficulty');
  assert.equal(reviewedHints.has('geo-caribbean-island'), false);
  assert.equal(reviewedHints.has('geo-island-country-americas'), false, 'Identical Caribbean shortlists do not receive multiple sampling slots');
  assert.equal(reviewedHints.has('geo-pacific-island'), false, 'A programme list cannot define a literal geographic shortlist');
  const atlantic = reviewedHints.get('geo-atlantic-coast');
  for (const code of ['DK', 'NL', 'SE', 'GR', 'UA']) assert.ok(atlantic.possibleExtraMatches.includes(code), code);
  assert.equal(atlantic.matches.length, 32, 'Expanded uncertain scopes do not create unreviewed positive assignments');
  assert.deepEqual(atlantic.maximumCounts, { 1: 28, 2: 57, 3: 93 });
});

test('broad region hints agree with the region shown when the country is revealed', () => {
  for (const hint of hintBank.catalog.filter(hint => hint.id.startsWith('geo-region-'))) {
    const region = hint.id.slice('geo-region-'.length);
    for (const code of hint.matches) assert.equal(findCountry(code).region.toLowerCase(), region, code);
  }
  assert.equal(findCountry('CY').region, 'Asia', 'Cyprus follows the same UN M49 convention in both displays');
});

test('round hints are stable across country copies and rendering never draws randomness', () => {
  const japan = findCountry('Japan');
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Rendering a hint must not draw a random number.'); };
  try {
    for (const seed of ['', 'round-cfb62a41-809a-4583-a351-dc46e31a0c6f', 'round-🌍-日本']) {
      for (const tier of [1, 2, 3]) {
        const exclusions = ['IT', 'KR'];
        const expected = openingHint(japan, seed, tier, exclusions);
        for (let count = 0; count < 12; count++) {
          assert.equal(openingHint(japan, seed, tier, exclusions), expected);
          assert.equal(openingHint({ ...japan, name: 'Caller-supplied name', tier: 3, guesses: ['IT', 'KR'], finished: false }, seed, tier, [...exclusions]), expected);
          assert.equal(openingHint({ code: 'JP' }, seed, tier, exclusions), expected);
          assert.equal(chooseOpeningHint(japan, seed, tier, exclusions).text, expected);
        }
      }
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('opening hint assignments and returned choices cannot be mutated by callers', () => {
  assert.ok(Object.isFrozen(STARTING_HINTS));
  assert.ok(Object.isFrozen(HINT_RULES));
  assert.ok(Object.isFrozen(HINT_RULES.pools));
  assert.ok(Object.isFrozen(HINT_RULES.minimumPossibleMatches));
  for (const country of COUNTRIES) {
    const choices = openingHintsFor(country);
    assert.ok(Object.isFrozen(STARTING_HINTS[country.code]), country.name);
    assert.ok(Object.isFrozen(choices), country.name);
    for (const hint of choices) {
      assert.ok(Object.isFrozen(hint), hint.id);
      assert.ok(Object.isFrozen(hint.eligibleTiers), hint.id);
      assert.ok(Object.isFrozen(hint.matches), hint.id);
      assert.ok(Object.isFrozen(hint.possibleExtraMatches), hint.id);
    }
  }
  const choices = openingHintsFor(findCountry('Japan'));
  assert.throws(() => choices.reverse(), TypeError);
  assert.throws(() => { choices[0].text = 'Changed clue'; }, TypeError);
  assert.throws(() => choices[0].eligibleTiers.push(0), TypeError);
  assert.throws(() => choices[0].matches.push('ZZ'), TypeError);
  assert.throws(() => { STARTING_HINTS.JP = []; }, TypeError);
});

test('unknown countries and invalid round tiers reject hint lookup clearly', () => {
  const japan = findCountry('Japan');
  for (const country of [null, undefined, {}, point(15, 30), { code: 'ZZ', tier: 1 }, { code: 'jp', tier: 1 }]) {
    assert.throws(() => openingHintsFor(country), RangeError);
    assert.throws(() => openingHint(country, 'round-1'), RangeError);
    assert.throws(() => openingHintsFor(country, 1), RangeError);
    assert.throws(() => openingHint(country, 'round-1', 1), RangeError);
  }
  for (const tier of [0, 4, -1, 1.5, '1', null, NaN, Infinity]) {
    assert.throws(() => openingHintsFor(japan, tier), RangeError);
    assert.throws(() => openingHint(japan, 'round-1', tier), RangeError);
  }
  for (const exclusions of [null, 'IT', ['ZZ'], ['jp'], ['JP']]) {
    assert.throws(() => openingHintsFor(japan, 1, exclusions), RangeError);
    assert.throws(() => openingHint(japan, 'round-1', 1, exclusions), RangeError);
  }
});
const approximately = (actual, expected, tolerance = 0.01) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} should be within ${tolerance} of ${expected}`,
);

test('country data covers 196 countries with unique codes and valid offline clues', () => {
  assert.equal(COUNTRIES.length, 196);
  assert.equal(new Set(COUNTRIES.map(country => country.code)).size, 196);
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.ok(Number.isFinite(country.lat) && Math.abs(country.lat) <= 90, country.name);
    assert.ok(Number.isFinite(country.lon) && Math.abs(country.lon) <= 180, country.name);
    assert.ok(country.population > 0 && country.area > 0, country.name);
    assert.ok([1, 2, 3].includes(country.tier), country.name);
    assert.equal(findCountry(country.name)?.code, country.code, country.name);
    assert.equal(findCountry(country.code)?.code, country.code, country.code);
  }
});

test('difficulty ramps expand cumulatively from 45 to 111 to 196 countries', () => {
  assert.deepEqual([1, 2, 3].map(tier => countriesForTier(tier).length), [45, 111, 196]);
  for (const country of countriesForTier(1)) assert.ok(countriesForTier(2).includes(country));
  assert.throws(() => countriesForTier(0), RangeError);
  assert.throws(() => countriesForTier('1'), RangeError);
});

test('shared country records and target pools cannot be mutated by a caller', () => {
  const country = COUNTRIES[0];
  const pool = countriesForTier(1);
  const codes = pool.map(item => item.code);
  assert.throws(() => { country.tier = 1; }, TypeError);
  assert.throws(() => country.aliases.push('Changed name'), TypeError);
  assert.throws(() => pool.reverse(), TypeError);
  assert.deepEqual(countriesForTier(1).map(item => item.code), codes);
});

test('comparison snapshots use resident population and consistent land area', () => {
  assert.equal(POPULATION_YEAR, 2024);
  assert.equal(AREA_YEAR, 2023);
  assert.equal(findCountry('Japan').area, 364569.27);
  assert.equal(findCountry('Canada').area, 8788700);
  assert.equal(findCountry('United States').area, 9147420);
  assert.equal(findCountry('China').area, 9388210);
  // Water-heavy Canada's familiar total-area rank differs from its land-area rank.
  assert.equal(clueFor(findCountry('Canada'), findCountry('China')).area, 'up');
  assert.equal(clueFor(findCountry('United States'), findCountry('China')).area, 'up');
  assert.equal(findCountry('Vatican City').area, 0.44);
  assert.equal(findCountry('Vatican City').population, 882);
});

test('great-circle distance is symmetric and correct on equatorial arcs', () => {
  approximately(distanceKm(point(0, 0), point(0, 90)), 10007.5572);
  approximately(distanceKm(point(0, 90), point(0, 0)), 10007.5572);
  approximately(distanceKm(point(0, 0), point(0, 180)), 20015.1144);
  assert.equal(distanceKm(point(42, 12), point(42, 12)), 0);
});

test('antimeridian routes take the short direction without negative distance', () => {
  const west = point(0, 179);
  const east = point(0, -179);
  approximately(distanceKm(west, east), 222.3902);
  approximately(initialBearing(west, east), 90);
  approximately(initialBearing(east, west), 270);
});

test('bearings handle cardinal directions, wrapping, and coincident locations', () => {
  const origin = point(0, 0);
  for (const [target, expected] of [[point(10, 0), 0], [point(0, 10), 90], [point(-10, 0), 180], [point(0, -10), 270]]) {
    approximately(initialBearing(origin, target), expected);
  }
  assert.equal(initialBearing(origin, origin), null);
  assert.equal(compassDirection(null), '•');
  assert.equal(compassDirection(360), '↑');
  assert.equal(compassDirection(-90), '←');
  assert.equal(compassDirection(22.499), '↑');
  assert.equal(compassDirection(22.5), '↗');
  assert.equal(compassDirection(337.5), '↑');
  assert.equal(directionName(45), 'northeast');
  assert.throws(() => compassDirection(NaN), RangeError);
});

test('distance bands use explicit boundaries', () => {
  assert.deepEqual([0, 499.99, 500, 1999.99, 2000, 4999.99, 5000, 9999.99, 10000, 20015.1].map(distanceBand),
    ['very close', 'very close', 'close', 'close', 'nearby', 'nearby', 'far', 'far', 'very far', 'very far']);
  assert.throws(() => distanceBand(-1), RangeError);
  assert.throws(() => distanceBand(Infinity), RangeError);
});

test('Japan clues describe target relative to Italy and South Korea', () => {
  const japan = findCountry('Japan');
  const italy = clueFor(findCountry('Italy'), japan);
  assert.equal(italy.direction, '↗');
  assert.equal(italy.distance, 'far');
  assert.equal(italy.population, 'up');
  assert.equal(italy.area, 'up');
  const korea = clueFor(findCountry('South Korea'), japan);
  assert.equal(korea.direction, '→');
  assert.equal(korea.distance, 'close');
  assert.equal(korea.population, 'up');
  assert.equal(korea.area, 'up');
});

test('reverse comparisons and matching guesses are unambiguous', () => {
  const japan = findCountry('Japan');
  const italy = findCountry('Italy');
  const reverse = clueFor(japan, italy);
  assert.equal(reverse.population, 'down');
  assert.equal(reverse.area, 'down');
  assert.deepEqual(clueFor(japan, japan), {
    correct: true, distanceKm: 0, bearing: null, direction: '✓', directionName: 'correct country',
    distance: 'found', population: 'equal', area: 'equal',
  });
  const sharedCoordinates = { ...japan, code: 'ZZ', population: japan.population, area: japan.area };
  assert.equal(clueFor(sharedCoordinates, japan).correct, false);
  assert.equal(clueFor(sharedCoordinates, japan).direction, '•');
});

test('common aliases, accents, and punctuation resolve while unknown names do not', () => {
  for (const [query, code] of [[' u.s.a. ', 'US'], ['UK', 'GB'], ['Côte d’Ivoire', 'CI'], ['Turkey', 'TR'],
    ['Turkiye', 'TR'], ['Czech Republic', 'CZ'], ['Sao Tome and Principe', 'ST'], ['D.R.C.', 'CD'],
    ['Burma', 'MM'], ['Swaziland', 'SZ'], ['East Timor', 'TL'], ['Holy See', 'VA'],
    ['Bosnia', 'BA'], ['Trinidad', 'TT'], ['St. Kitts', 'KN'], ['St Vincent', 'VC'], ['Sao Tome', 'ST'],
    ['Cote dIvoire', 'CI'], ['Democratic Republic Congo', 'CD'], ['UAE', 'AE'], ['PNG', 'PG']]) {
    assert.equal(findCountry(query)?.code, code, query);
  }
  assert.equal(normalizeCountryName('  Côte d’Ivoire '), 'cote d ivoire');
  assert.equal(findCountry('Atlantis'), null);
  assert.equal(findCountry(''), null);
  assert.equal(findCountry(null), null);
  assert.equal(findCountry('Congo'), null, 'Ambiguous Congo should require selecting a country.');
  assert.equal(findCountry('Korea'), null, 'Ambiguous Korea should require selecting a country.');
});

test('invalid coordinates are rejected before generating misleading clues', () => {
  assert.throws(() => distanceKm(point(91, 0), point(0, 0)), RangeError);
  assert.throws(() => initialBearing(point(0, NaN), point(0, 0)), RangeError);
  assert.throws(() => distanceKm({}, point(0, 0)), RangeError);
});

test('all country pairs yield finite distances and valid directions and comparisons', () => {
  for (const guess of COUNTRIES) {
    for (const target of COUNTRIES) {
      const clue = clueFor(guess, target);
      assert.ok(Number.isFinite(clue.distanceKm) && clue.distanceKm >= 0 && clue.distanceKm <= 20016);
      assert.ok(['up', 'down', 'equal'].includes(clue.population));
      assert.ok(['up', 'down', 'equal'].includes(clue.area));
      assert.equal(clue.correct, guess.code === target.code);
      if (!clue.correct) assert.ok(['↑', '↗', '→', '↘', '↓', '↙', '←', '↖', '•'].includes(clue.direction));
    }
  }
});
