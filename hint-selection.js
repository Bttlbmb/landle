import { COUNTRIES } from './data.js';

const COUNTRY_CODES = new Set(COUNTRIES.map(country => country.code));
const POOLS = [null, ...[1, 2].map(tier => Object.freeze(COUNTRIES.filter(country => country.tier <= tier))), COUNTRIES];
const CACHE_LIMIT = 64;

/** Cumulative difficulty pools share immutable country records and dataset order. */
export function countriesForTier(tier) {
  if (![1, 2, 3].includes(tier)) throw new RangeError('Difficulty tier must be 1, 2, or 3.');
  return POOLS[tier];
}

function seedNumber(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Candidate review and gameplay use the same eligibility and selection rules. */
export function createHintSelector(countryHints, rules) {
  const membership = new Map();
  const wording = new Map();
  const rounds = new Map();
  for (const hints of Object.values(countryHints)) {
    for (const hint of hints) {
      if (membership.has(hint.id)) continue;
      membership.set(hint.id, {
        hint,
        confirmed: new Set(hint.matches),
        possible: new Set([...hint.matches, ...(hint.possibleExtraMatches || [])]),
      });
      wording.set(hint.id, hint.text);
    }
  }

  function hintsForPool(tier, pool) {
    const eligible = new Set();
    // A phrase can belong to many countries. Count it once per pool, rather
    // than repeating the same membership scan for each of its assignments.
    for (const [id, { hint, confirmed, possible }] of membership) {
      if (!hint.eligibleTiers.includes(tier)) continue;
      let count = 0, maximum = 0;
      for (const country of pool) {
        if (confirmed.has(country.code)) count++;
        if (possible.has(country.code)) maximum++;
      }
      if (count >= rules.minimumMatches && maximum >= rules.minimumPossibleMatches[tier]
        && maximum <= rules.maximumFraction * pool.length) eligible.add(id);
    }
    return new Map(pool.map(country => [country.code,
      Object.freeze((countryHints[country.code] || []).filter(hint => eligible.has(hint.id))),
    ]));
  }

  function roundFor(tier, excludedCodes) {
    const base = countriesForTier(tier);
    // Array.from also catches holes in a malformed saved exclusion array.
    if (!Array.isArray(excludedCodes) || Array.from(excludedCodes).some(code => !COUNTRY_CODES.has(code))) {
      throw new RangeError('Excluded answers must be known country codes.');
    }
    const excluded = new Set(excludedCodes);
    const key = tier + ':' + [...excluded].sort().join(',');
    if (rounds.has(key)) return rounds.get(key);
    let pool = base.filter(country => !excluded.has(country.code));
    // Removing an answer without a fair hint changes other phrases' counts.
    // Repeat until every remaining answer has a hint against the final pool.
    while (pool.length) {
      const hints = hintsForPool(tier, pool);
      const eligible = pool.filter(country => hints.get(country.code).length);
      if (eligible.length === pool.length) {
        const result = { countries: Object.freeze(pool), hints };
        // Bound memory during long sessions; cached hint arrays stay immutable.
        if (rounds.size >= CACHE_LIMIT) rounds.delete(rounds.keys().next().value);
        rounds.set(key, result);
        return result;
      }
      pool = eligible;
    }
    throw new RangeError('At least one country with a fair starting hint must remain available.');
  }

  /** Cooldowns and reviewed hint breadth determine the actual answer pool. */
  function countriesForRound(tier, excludedCodes = []) {
    return roundFor(tier, excludedCodes).countries;
  }

  function openingHintsFor(country, tier = country?.tier, excludedCodes = []) {
    const hints = roundFor(tier, excludedCodes).hints.get(country?.code);
    if (!hints) throw new RangeError('The country must be available at this difficulty.');
    return hints;
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
    // Independent hash bits choose the family and fact so every alternative
    // remains reachable. The four slots give family weights of 25/25/50%.
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
