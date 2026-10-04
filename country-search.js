import { COUNTRIES } from './data.js';
import { findCountry, normalizeCountryName } from './geography.js';

const compact = text => normalizeCountryName(text).replaceAll(' ', '');
const searchIndex = COUNTRIES.map(country => ({
  country,
  name: compact(country.name),
  aliases: [...new Set([country.name, country.code, ...country.aliases].map(compact))],
})).sort((a, b) => a.country.name.localeCompare(b.country.name));

/** Exact names, aliases, and ISO codes always outrank incidental substring matches. */
export function searchCountries(text, limit = 8) {
  const query = compact(text);
  const count = Math.max(0, Math.floor(limit));
  if (!query || !count) return [];
  const exact = findCountry(text);
  const prefixes = [];
  const others = [];
  // Each group retains the index's alphabetical order without sorting on every keystroke.
  for (const entry of searchIndex) {
    if (entry.country === exact || !entry.aliases.some(alias => alias.includes(query))) continue;
    (entry.name.startsWith(query) ? prefixes : others).push(entry.country);
  }
  return [...(exact ? [exact] : []), ...prefixes, ...others].slice(0, count);
}
