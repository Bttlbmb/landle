import { COUNTRIES } from './data.js';

const COUNTRY_CODES = new Set(COUNTRIES.map(country => country.code));
const POOLS = [null, ...[1, 2, 3].map(tier => COUNTRIES.filter(country => country.tier <= tier))];

function seedNumber(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** The same selector is used to evaluate a candidate bank and play its reviewed export. */
export function createHintSelector(countryHints, rules) {
  const membership = new Map();
  const wording = new Map();
  const roundPools = new Map();
  for (const hints of Object.values(countryHints)) {
    for (const hint of hints) {
      if (membership.has(hint.id)) continue;
      const facts = hint;
      if (!facts) throw new Error('Starting-hint membership must match the reviewed bank.');
      membership.set(hint.id, {
        confirmed: new Set(facts.matches),
        possible: new Set([...facts.matches, ...(facts.possibleExtraMatches || [])]),
      });
      wording.set(hint.id, hint.text);
    }
  }

  function validatePool(tier, excludedCodes) {
    if (![1, 2, 3].includes(tier)) throw new RangeError('Hint difficulty must be 1, 2, or 3.');
    if (!Array.isArray(excludedCodes) || Array.from(excludedCodes).some(code => !COUNTRY_CODES.has(code))) {
      throw new RangeError('Excluded answers must be known country codes.');
    }
  }

  function eligibleHints(country, tier, pool) {
    return (countryHints[country?.code] || []).filter(hint => {
      if (!hint.eligibleTiers.includes(tier)) return false;
      const { confirmed, possible } = membership.get(hint.id);
      let count = 0, maximum = 0;
      for (const item of pool) {
        if (confirmed.has(item.code)) count++;
        if (possible.has(item.code)) maximum++;
      }
      return count >= rules.minimumMatches && maximum >= rules.minimumPossibleMatches[tier]
        && maximum <= rules.maximumFraction * pool.length;
    });
  }

  /** Cooldowns and reviewed hint breadth determine the actual possible answers. */
  function countriesForRound(tier, excludedCodes = []) {
    validatePool(tier, excludedCodes);
    const excluded = new Set(excludedCodes);
    const key = tier + ':' + [...excluded].sort().join(',');
    if (roundPools.has(key)) return roundPools.get(key);
    let pool = POOLS[tier].filter(country => !excluded.has(country.code));
    // Removing a country with no safe hint also removes it from other hints' match counts.
    // Repeat until all answers have a fair hint against the same final answer pool.
    while (pool.length) {
      const eligible = pool.filter(country => eligibleHints(country, tier, pool).length);
      if (eligible.length === pool.length) {
        const result = Object.freeze(pool);
        if (roundPools.size >= 256) roundPools.delete(roundPools.keys().next().value);
        roundPools.set(key, result);
        return result;
      }
      pool = eligible;
    }
    throw new RangeError('At least one country with a fair starting hint must remain available.');
  }

  function openingHintsFor(country, tier = country?.tier, excludedCodes = []) {
    const pool = countriesForRound(tier, excludedCodes);
    if (!pool.some(item => item.code === country?.code)) {
      throw new RangeError('The country must be available at this difficulty.');
    }
    const hints = eligibleHints(country, tier, pool);
    if (!hints.length) throw new RangeError('The country needs an eligible reviewed starting hint.');
    return Object.freeze(hints);
  }

  /** Prefer unseen wording, then the least recently shown eligible wording. */
  function chooseOpeningHint(country, seed = '', tier = country?.tier, excludedCodes = [], recentHintIds = []) {
    if (!Array.isArray(recentHintIds) || Array.from(recentHintIds).some(id => !wording.has(id))) {
      throw new RangeError('Recent hints must be reviewed hint IDs.');
    }
    const hints = openingHintsFor(country, tier, excludedCodes);
    const recent = recentHintIds.slice(-6).map(id => wording.get(id));
    let choices = hints.filter(hint => !recent.includes(hint.text));
    if (!choices.length) {
      const oldest = Math.min(...hints.map(hint => recent.lastIndexOf(hint.text)));
      choices = hints.filter(hint => recent.lastIndexOf(hint.text) === oldest);
    }
    const value = seedNumber(seed);
    const buckets = [
      choices.filter(hint => hint.family === 'name'),
      choices.filter(hint => hint.family === 'population' || hint.family === 'area'),
      choices.filter(hint => hint.family === 'geography'),
    ];
    // Separate bits choose the family and its fact; sharing low bits can hide alternatives.
    const slot = value & 3;
    const family = slot < 2 ? slot : 2;
    const bucket = buckets[family].length ? buckets[family] : buckets.find(items => items.length);
    return bucket[(value >>> 2) % bucket.length];
  }

  function openingHint(country, seed = '', tier = country?.tier, excludedCodes = [], recentHintIds = []) {
    return chooseOpeningHint(country, seed, tier, excludedCodes, recentHintIds).text;
  }

  return Object.freeze({ countriesForRound, openingHintsFor, chooseOpeningHint, openingHint });
}
