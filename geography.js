import { COUNTRIES } from './data.js';
import { STARTING_HINTS, HINT_RULES } from './starting-hints.js';
import { createHintSelector } from './hint-selection.js';

const RADIANS = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const DIRECTION_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

function coordinates(country) {
  const lat = country?.lat;
  const lon = country?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError('A country needs valid latitude and longitude.');
  }
  return [lat * RADIANS, lon * RADIANS];
}

function distanceBetween(lat1, lon1, lat2, lon2) {
  const haversine = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  // Floating-point rounding can put antipodal points just outside [0, 1].
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

function bearingBetween(lat1, lon1, lat2, lon2, km) {
  if (km < 0.000001) return null;
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) / RADIANS + 360) % 360;
}

/** Great-circle distance between the two country reference points, in kilometres. */
export function distanceKm(from, to) {
  const [lat1, lon1] = coordinates(from);
  const [lat2, lon2] = coordinates(to);
  return distanceBetween(lat1, lon1, lat2, lon2);
}

/** Initial great-circle bearing in degrees clockwise from north. Null when coincident. */
export function initialBearing(from, to) {
  const [lat1, lon1] = coordinates(from);
  const [lat2, lon2] = coordinates(to);
  return bearingBetween(lat1, lon1, lat2, lon2, distanceBetween(lat1, lon1, lat2, lon2));
}

function compassIndex(bearing) {
  if (!Number.isFinite(bearing)) throw new RangeError('A bearing must be a finite number.');
  return Math.round(((bearing % 360 + 360) % 360) / 45) % 8;
}

export function compassDirection(bearing) {
  if (bearing === null) return '•';
  return ARROWS[compassIndex(bearing)];
}

export function directionName(bearing) {
  if (bearing === null) return 'same location';
  return DIRECTION_NAMES[compassIndex(bearing)];
}

export const DISTANCE_BANDS = Object.freeze([
  Object.freeze({ label: 'very close', max: 500 }),
  Object.freeze({ label: 'close', max: 2000 }),
  Object.freeze({ label: 'nearby', max: 5000 }),
  Object.freeze({ label: 'far', max: 10000 }),
  Object.freeze({ label: 'very far', max: Infinity }),
]);

export function distanceBand(km) {
  if (!Number.isFinite(km) || km < 0) throw new RangeError('Distance must be a nonnegative finite number.');
  return DISTANCE_BANDS.find(band => km < band.max).label;
}

function comparison(guess, target) {
  if (!Number.isFinite(guess) || !Number.isFinite(target)) throw new RangeError('Comparison values must be finite.');
  return target > guess ? 'up' : target < guess ? 'down' : 'equal';
}

/** Comparisons describe the hidden target relative to the guessed country. */
export function clueFor(guess, target) {
  const correct = Boolean(guess.code && target.code && guess.code === target.code);
  // Share coordinate validation and distance work between the displayed clues.
  const [lat1, lon1] = coordinates(guess);
  const [lat2, lon2] = coordinates(target);
  const km = distanceBetween(lat1, lon1, lat2, lon2);
  const bearing = correct ? null : bearingBetween(lat1, lon1, lat2, lon2, km);
  return {
    correct,
    distanceKm: correct ? 0 : km,
    bearing,
    direction: correct ? '✓' : compassDirection(bearing),
    directionName: correct ? 'correct country' : directionName(bearing),
    distance: correct ? 'found' : distanceBand(km),
    population: comparison(guess.population, target.population),
    area: comparison(guess.area, target.area),
  };
}

// Keep dataset order so answer pools have a consistent ordering.
const TIER_COUNTRIES = [null, ...[1, 2].map(tier => Object.freeze(COUNTRIES.filter(country => country.tier <= tier))), COUNTRIES];

export function countriesForTier(tier) {
  if (![1, 2, 3].includes(tier)) throw new RangeError('Difficulty tier must be 1, 2, or 3.');
  return TIER_COUNTRIES[tier];
}

/** One reviewed hint stays fixed against the available pool saved for this round. */
export const { countriesForRound, openingHintsFor, chooseOpeningHint, openingHint } = createHintSelector(STARTING_HINTS, HINT_RULES);

export function normalizeCountryName(name) {
  return String(name ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/\./g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const COUNTRY_LOOKUP = new Map();
for (const country of COUNTRIES) {
  for (const name of [country.name, country.code, ...country.aliases]) {
    const normalized = normalizeCountryName(name);
    // Avoid silently resolving an ambiguous alias to whichever country appears last.
    if (!COUNTRY_LOOKUP.has(normalized)) COUNTRY_LOOKUP.set(normalized, country);
    else if (COUNTRY_LOOKUP.get(normalized)?.code !== country.code) COUNTRY_LOOKUP.set(normalized, null);
  }
}

export function findCountry(query) {
  return COUNTRY_LOOKUP.get(normalizeCountryName(query)) ?? null;
}
