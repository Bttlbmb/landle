# Country data and clues

Ländle uses a fixed set of country data assembled on **3 October 2026**, with Taiwan added on **5 October 2026**. It does not fetch new figures while you play. This keeps the clues consistent, although newer estimates may differ.

## Which countries are included?

The game covers **196 countries**: the 193 United Nations members, Palestine, Vatican City and Taiwan. It does not include every territory or settle questions of recognition. You can guess any of these countries in every round.

Names, country codes, regions and geographic reference points come from [mledoze/countries](https://github.com/mledoze/countries), using its [countries.json](https://raw.githubusercontent.com/mledoze/countries/master/countries.json) snapshot. Its UN-member flag includes Vatican City; Palestine and Taiwan were added separately. Cyprus uses the [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/) classification of Asia for both hints and the revealed region. Geographic, political and cultural groupings can differ.

Common alternative names, spellings and two- or three-letter country codes are accepted. “Congo” and “Korea” require selecting the intended country. Easy has 45 possible answers, Medium has 111, and Hard has all 196. These groups are editorial choices: a larger pool does not make every country harder to find. Recent answers and hint checks can reduce the pool; Help shows the remaining countries.

## Population and land area

For **194 countries**, these figures come from the World Bank's World Development Indicators, retrieved on 3 October 2026. The downloaded data reported an update date of 13 July 2026.

| Figure | Year | Source |
| --- | --- | --- |
| Resident population | 2024 | [Population, total — SP.POP.TOTL](https://data.worldbank.org/indicator/SP.POP.TOTL), via the [Indicators API](https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?date=2024&format=json&per_page=400) |
| Land area in km² | 2023 | [Land area — AG.LND.TOTL.K2](https://data.worldbank.org/indicator/AG.LND.TOTL.K2), via the [Indicators API](https://api.worldbank.org/v2/country/all/indicator/AG.LND.TOTL.K2?date=2023&format=json&per_page=400) |

The World Bank population series counts residents. The World Bank draws on the UN Population Division, national statistical offices, Eurostat and the UN Statistics Division. These are estimates, and migration, conflict and later revisions can change them.

Land area excludes inland water, continental-shelf claims and exclusive economic zones. The figures come from FAOSTAT, maintained by the UN Food and Agriculture Organization. Its [methodology](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/AG.LND.TOTL.K2) also acknowledges differences in how countries report their area.

Excluding water can change familiar rankings. In this snapshot, Canada's **8,788,700 km² of land** is less than the United States' **9,147,420 km²** or China's **9,388,210 km²**. Rankings that include lakes can differ.

**Vatican City** is absent from these World Bank series. It uses **882 residents**, including citizens and non-citizens, from the [official population report](https://www.vaticanstate.va/en/state-and-government/general-informations/population.html) dated 31 December 2024. Its **0.44 km²** comes from the [official geography publication](https://www.vaticanstate.va/en/state-and-government/general-informations/geography.html): 44 hectares.

**Taiwan** is absent from these World Bank series. It uses **23,400,220 people** from the Ministry of the Interior's [December 2024 household register](https://www.ris.gov.tw/documents/data/5/2/DemographicQuarterly_Winter2024.pdf), Table 8. This is a year-end registered population, which differs from resident-population estimates. Its **32,260 km² of land** comes from the [CIA's 2021 geography archive](https://www.cia.gov/the-world-factbook/about/archives/2021/static/826030ce49a2efae1e5291b73991738a/TW-summary.pdf), excluding the separately reported 3,720 km² of water. This older archive is a documented exception to the 2023 land-area snapshot; the country database's total area is not used. The original CIA archive URL now redirects following retirement of the Factbook. Taiwan's name, codes, reference point and Asia region use the preserved country snapshot.

## What the clues mean

Every clue compares **the answer with your guess**. For population and land area, ↑ means more or larger, ↓ means fewer or smaller, and = means the stored figures match. Because figures are rounded at the source, equal land area can occur for different countries.

Direction and distance use one approximate reference point per country. They do not measure the distance between borders or capitals. A single point cannot represent every part of a large country or island group, and its geographic scope may differ from that of the population or land-area figures.

Distance follows the shortest route over a spherical Earth. The arrow shows the route's starting direction, rounded to eight compass points. Long routes can curve toward the poles, which explains why an arrow may differ from a line drawn on a flat map. The calculation uses the haversine formula and a mean Earth radius of 6,371.0088 km. Identical points have no direction; a correct guess is identified by the country code.

| Distance label | Distance between reference points |
| --- | --- |
| Very close | Under 500 km |
| Close | 500 to under 2,000 km |
| Nearby | 2,000 to under 5,000 km |
| Far | 5,000 to under 10,000 km |
| Very far | 10,000 km or more |

For example, with Japan as the answer, Italy gives **↗ far · people ↑ · area ↑**. South Korea gives **→ close · people ↑ · area ↑**.

## Starting hints

Each round shows one reviewed fact about the answer's name, population, land area or geography. It stays fixed throughout the round. The bank contains four examples per country, but the game chooses from every reviewed alternative that fits the difficulty and remaining answer pool. Name and numerical hints each receive roughly a quarter of selections; geography receives roughly half. Recent wording is avoided when a suitable alternative exists.

A hint must fit at least four confirmed countries and no more than 70% of the remaining answer pool. On Medium and Hard, at least seven countries must be able to fit, including uncertain cases. These uncertain cases are counted as a precaution; the game assigns the hint only to a confirmed match. Counts are checked again after recent answers are removed. If a country has no fair hint, it is removed too, and the check repeats until the pool is consistent.

Name hints use the displayed English name. Accents do not change letters, spaces and hyphens are not letters, and vowels are A, E, I, O and U. Numerical hints use the same figures as the guessing clues.

Geography hints describe country-level facts, rather than the reference points used for direction and distance. Sources include the country database, UN classifications, independent geographic references and official country publications. Each phrase's sources and conventions are recorded in the [complete hint bank](starting-hints.json).

Border facts account for the Canada–Denmark land border established in 2022 and the Botswana–Zambia border. Hong Kong and Macao are treated as part of China; sea crossings are not land borders. Ambiguous exact border counts are omitted. Island status is checked separately, rather than inferred from an empty border list.

Neighbour-size hints compare the land-area snapshot. Where adjoining territory and sovereign-country figures could reverse the result, the case remains uncertain; Suriname's border with French Guiana is one example. Pacific coast wording includes its seas. Some hints group North America, Central America and the Caribbean. South and West Asia are combined because sources classify Iran differently.

The bank retains sources, confirmed and possible matches, eligible difficulties, conventions, attribution and two independent review certificates. The repository also retains the geography source facts and original review reports. Those reports certify the recorded bank contents; later implementation changes are checked by the current tests.

## Attribution and licences

The names and geography database derives from mledoze/countries, © its contributors, under the **Open Database Licence 1.0 (ODbL)**. Ländle's derived country and hint databases use the same licence, included in [DATA_LICENSE.txt](DATA_LICENSE.txt). Changes include selected fields, the country roster, aliases, difficulty groups, replacement population and land-area figures, geography corrections and hint assignments. Application code and styling are separate from the database.

World Bank, World Development Indicators: **SP.POP.TOTL (2024)** and **AG.LND.TOTL.K2 (2023)**, retrieved 3 October 2026. The [population](https://data.worldbank.org/indicator/SP.POP.TOTL) and [land-area](https://data.worldbank.org/indicator/AG.LND.TOTL.K2) pages specify **Creative Commons Attribution 4.0**. Vatican City figures are attributed to the official publications linked above. Local font notices are in `fonts/`.
