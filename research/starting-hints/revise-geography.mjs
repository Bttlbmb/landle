import { readFile, writeFile } from 'node:fs/promises';
import { COUNTRIES } from '../../data.js';

// Rebuild neighbour-size facts from the reviewed border graph and land-area snapshot.
// A neighbour's own uncertain border count does not make its land area unknown.
const location = new URL('geography-draft.json', import.meta.url);
const draft = JSON.parse(await readFile(location, 'utf8'));
const countryByCode = new Map(COUNTRIES.map(country => [country.code, country]));
const groupById = new Map(draft.factGroups.map(group => [group.id, group]));
const suriname = draft.records.find(record => record.code === 'SR');
suriname.neighbourAreaAllowed = false;
const scopeNote = 'French Guiana is smaller than Suriname, while the stored France land area is larger. Keep universal/mixed neighbour-size comparisons uncertain; Brazil and Guyana independently establish a larger neighbour.';
if (!suriname.notes.includes(scopeNote)) suriname.notes.push(scopeNote);

const comparisons = new Map();
for (const record of draft.records.filter(record => record.neighbourAreaAllowed && record.borders.length)) {
  const area = countryByCode.get(record.code).area;
  const neighbourAreas = record.borders.map(code => {
    // Brazil's result is unchanged whether French Guiana or sovereign France is compared.
    const neighbour = countryByCode.get(code === 'GF' ? 'FR' : code);
    if (!neighbour) throw new Error(`Unknown neighbour area ${record.code}/${code}`);
    return neighbour.area;
  });
  comparisons.set(record.code, {
    smaller: neighbourAreas.some(value => value < area),
    larger: neighbourAreas.some(value => value > area),
    allSmaller: neighbourAreas.every(value => value < area),
    allLarger: neighbourAreas.every(value => value > area),
  });
}
const predicates = {
  'all-smaller-land-neighbours': fact => fact.allSmaller,
  'all-larger-land-neighbours': fact => fact.allLarger,
  'smaller-and-larger-land-neighbours': fact => fact.smaller && fact.larger,
  'at-least-one-smaller-land-neighbour': fact => fact.smaller,
  'at-least-one-larger-land-neighbour': fact => fact.larger,
};
for (const [id, predicate] of Object.entries(predicates)) {
  const group = groupById.get(id);
  group.codes = COUNTRIES.filter(country => comparisons.has(country.code) && predicate(comparisons.get(country.code)))
    .map(country => country.code);
  if (id === 'at-least-one-larger-land-neighbour') group.codes.push('SR');
  group.notes = [
    'Comparison uses the 2023 World Bank land-area snapshot in data.js and every permitted neighbour in the reviewed border graph. The neighbouring country does not need an unambiguous neighbour count of its own.',
    'Ambiguous target border/area scopes remain conservative possible extras. Suriname is uncertain except for its independently established larger neighbours Brazil and Guyana.',
    ...(id === 'all-smaller-land-neighbours' ? ['Brazil has only smaller neighbours whether French Guiana or sovereign France is compared; all of Russia’s neighbouring countries are smaller.'] : []),
  ];
}

// Keep one concise phrase for the identical Caribbean shortlist.
for (const id of ['caribbean-island', 'island-country-americas']) {
  const group = groupById.get(id);
  group.displaySafe = false;
  group.displayNotes = 'The same 13 countries are already covered by “In the Caribbean.” Keep one selectable phrase so this shortlist is not counted three times.';
}
const pacificIsland = groupById.get('pacific-island');
pacificIsland.displaySafe = false;
pacificIsland.displayNotes = 'The UN Pacific office programme list is not an exhaustive geographic Pacific-island list. Use the separately verified Oceania island group instead.';
const atlantic = groupById.get('atlantic-coast');
const possibleAtlantic = new Set([
  ...atlantic.possibleExtraCodes,
  ...['north-sea-coast', 'baltic-coast', 'mediterranean-coast', 'black-sea-coast'].flatMap(id => {
    const group = groupById.get(id);
    return [...group.codes, ...(group.possibleExtraCodes || [])];
  }),
  'DK', 'NL',
]);
atlantic.possibleExtraCodes = COUNTRIES.filter(country => possibleAtlantic.has(country.code) && !atlantic.codes.includes(country.code)).map(country => country.code);
atlantic.sources = [...new Set([...atlantic.sources,
  'https://denmark.dk/people-and-culture/the-faroe-islands',
  'https://www.government.nl/themes/government-and-democracy/caribbean-parts-of-the-kingdom',
  'https://www.st.nmfs.noaa.gov/nauplius/media/igmets/reports/IOC-UNESCO__TS129__ch04__North-Atlantic-only.pdf',
])];
const atlanticNote = 'The upper bound includes all reviewed North Sea, Baltic, Mediterranean and Black Sea coastal sets, plus Denmark and Netherlands overseas Atlantic scopes. These are conservative possibilities, not new assignments of the direct Atlantic clue.';
if (!atlantic.notes.includes(atlanticNote)) atlantic.notes.push(atlanticNote);
groupById.get('north-america').text = 'In North or Central America, or the Caribbean.';
const central = groupById.get('un-location-central-america');
central.displaySafe = false;
central.displayNotes = 'UN M49 includes Mexico, while players commonly read Central America as the seven countries south of Mexico. Use the explicit North/Central America/Caribbean alternative instead.';
const south = groupById.get('un-location-southern-asia');
south.displaySafe = false;
south.displayNotes = 'Iran is in UN Southern Asia, but players often read South Asia more narrowly. Use the clear South-or-West-Asia union instead.';
const west = groupById.get('un-location-western-asia');
const unionId = 'south-or-west-asia';
const union = {
  id: unionId, text: 'In South or West Asia.', dimension: 'location',
  codes: COUNTRIES.filter(country => [...south.codes, ...west.codes].includes(country.code)).map(country => country.code),
  sources: [...new Set([...south.sources, ...west.sources])],
  notes: ['Union of the verified UN M49 Southern Asia and Western Asia memberships. The wording accommodates the everyday West Asia classification of Iran.'],
};
const previousUnion = draft.factGroups.findIndex(group => group.id === unionId);
if (previousUnion < 0) draft.factGroups.push(union);
else draft.factGroups[previousUnion] = union;
draft.revision.finalCorrections = {
  rebuiltNeighbourAreaGroups: Object.keys(predicates),
  reason: 'The previous groups skipped targets when a neighbour had ambiguous border scope, even though its land-area comparison was known; those omitted positive countries understated breadth.',
  suriname: scopeNote,
  canonicalCaribbeanPhrase: 'In the Caribbean.',
  retiredProgrammePhrase: pacificIsland.id,
  expandedAtlanticUpperBound: atlantic.possibleExtraCodes,
  regionalCopy: [union.text, groupById.get('north-america').text],
};
draft.revision.membershipsChanged = true;
draft.revision.existingGroupMembershipsChanged = true;
draft.revision.purpose = 'Clear basic player wording, complete supported neighbour-size memberships, and conservative bounds for uncertain geographic scopes.';
await writeFile(location, JSON.stringify(draft, null, 2) + '\n');
console.log(JSON.stringify({ neighbourAreaMembers: Object.fromEntries(Object.keys(predicates).map(id => [id, groupById.get(id).codes.length])), regionalCopy: draft.revision.finalCorrections.regionalCopy }));
