import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES } from '../data.js';
import { findCountry } from '../geography.js';
import { searchCountries } from '../country-search.js';

test('exact codes outrank incidental name substrings in all 196 countries', () => {
  for (const country of COUNTRIES) {
    assert.equal(searchCountries(country.code.toLowerCase())[0]?.code, country.code, country.code);
  }
});

test('every unambiguous name and alias is the first suggested country', () => {
  for (const country of COUNTRIES) {
    for (const alias of [country.name, ...country.aliases]) {
      if (findCountry(alias)?.code === country.code) {
        assert.equal(searchCountries(alias)[0]?.code, country.code, alias);
      }
    }
  }
});

test('accent-insensitive, partial, and shortened searches find complete country names', () => {
  assert.equal(searchCountries('cote divoire')[0].code, 'CI');
  assert.equal(searchCountries('turkiye')[0].code, 'TR');
  assert.equal(searchCountries('new zea')[0].code, 'NZ');
  assert.equal(searchCountries('sao tome')[0].code, 'ST');
  assert.equal(searchCountries('United King')[0].code, 'GB');
});

test('ambiguous country searches show both choices and never silently resolve an alias', () => {
  assert.equal(findCountry('Congo'), null);
  assert.deepEqual(new Set(searchCountries('Congo').map(country => country.code)), new Set(['CD', 'CG']));
  assert.equal(findCountry('Korea'), null);
  assert.deepEqual(new Set(searchCountries('Korea').map(country => country.code)), new Set(['KP', 'KR']));
});

test('empty and unknown queries show no countries, while broad queries stay bounded', () => {
  assert.deepEqual(searchCountries(''), []);
  assert.deepEqual(searchCountries('  '), []);
  assert.deepEqual(searchCountries('Atlantis'), []);
  assert.equal(searchCountries('a').length, 8);
  assert.equal(searchCountries('a', 3).length, 3);
});

test('suggestions rank exact matches before prefixes, then keep each group alphabetical', () => {
  assert.deepEqual(searchCountries('us', 4).map(country => country.name), [
    'United States', 'Australia', 'Austria', 'Belarus',
  ]);
  const query = 'united';
  const countries = searchCountries(query, Infinity);
  const prefixes = countries.filter(country => country.name.toLowerCase().startsWith(query));
  const others = countries.filter(country => !country.name.toLowerCase().startsWith(query));
  const alphabetically = items => [...items].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(countries, [...alphabetically(prefixes), ...alphabetically(others)]);
  assert.equal(searchCountries('a', 2.9).length, 2);
  for (const limit of [0, -1, NaN]) assert.deepEqual(searchCountries('a', limit), []);
});

test('Taiwan names and codes resolve separately from China', () => {
  for (const query of ['Taiwan', 'TW', 'TWN', 'Táiwān', 'Republic of China', 'Republic of China (Taiwan)', 'Chinese Taipei', '台灣', '臺灣', '台湾']) {
    assert.equal(findCountry(query)?.code, 'TW', query);
    assert.equal(searchCountries(query)[0]?.code, 'TW', query);
  }
  assert.equal(searchCountries('taiw')[0]?.code, 'TW');
  assert.equal(findCountry('China')?.code, 'CN');
  assert.equal(findCountry('CN')?.code, 'CN');
});
