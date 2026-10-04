# Country data and clues

Ländle embeds a fixed country dataset in `data.js`, assembled on **3 October 2026**. It fetches no new figures while you play. Clues stay consistent within this version, though newer estimates may differ.

## Countries and names

The **195 countries** are the 193 United Nations members, Palestine, and Vatican City. This game scope does not cover every territory or resolve disputed recognition.

Names, ISO country codes, regions, and geographic reference points come from [mledoze/countries](https://github.com/mledoze/countries), downloaded from [countries.json](https://raw.githubusercontent.com/mledoze/countries/master/countries.json). Its UN-member flag also includes Vatican City; Palestine was added separately. These upstream files can change after the snapshot date.

Cyprus uses the [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/) Asia classification in both starting hints and the revealed region, keeping those displays consistent. This is a geographic label; political and cultural groupings can differ.

Selected alternative spellings, everyday names, and two- and three-letter codes are accepted. “Republic of the Congo” is distinguished from “DR Congo”. Entering “Congo” or “Korea” requires selecting the intended country.

All countries can be guessed in every round. Answer pools grow cumulatively from Easy (45) to Medium (110) to Hard (195). The difficulty groups are editorial choices; a larger pool does not make every puzzle harder.

## Population and land area

For **194 countries**, population and land area come from the World Bank's World Development Indicators, retrieved on 3 October 2026. Both API responses reported `lastupdated: 2026-07-13`.

| Figure | Snapshot | Source |
| --- | --- | --- |
| Resident population | 2024 | [Population, total — SP.POP.TOTL](https://data.worldbank.org/indicator/SP.POP.TOTL), via the [Indicators API](https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?date=2024&format=json&per_page=400) |
| Land area in km² | 2023 | [Land area — AG.LND.TOTL.K2](https://data.worldbank.org/indicator/AG.LND.TOTL.K2), via the [Indicators API](https://api.worldbank.org/v2/country/all/indicator/AG.LND.TOTL.K2?date=2023&format=json&per_page=400) |

Population counts residents and follows the source's country and economy definitions. The World Bank attributes it to the UN Population Division, national statistical offices, Eurostat, and the UN Statistics Division. Migration, conflict, and revisions can change these estimates.

Land area excludes inland waters, continental-shelf claims, and exclusive economic zones. The figures come from FAOSTAT, maintained by the UN Food and Agriculture Organization. Its [methodology](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/AG.LND.TOTL.K2) acknowledges differences in reporting between countries.

Excluding water can change familiar rankings. Canada's **8,788,700 km² of land** is less than the United States' **9,147,420 km²** or China's **9,388,210 km²** in this snapshot. Rankings that include lakes can differ.

**Vatican City** has no values in these World Bank series. It uses **882 residents**, from the [official population report](https://www.vaticanstate.va/en/state-and-government/general-informations/population.html) dated 31 December 2024, and **0.44 km²**, from the [official geography publication](https://www.vaticanstate.va/en/state-and-government/general-informations/geography.html). The count includes citizens and non-citizens; the area is 44 hectares.

## How to read the clues

Every clue describes **the answer relative to your guess**. For population and land area, ↑ means more or larger, ↓ means fewer or smaller, and = means matching stored figures. Source rounding is preserved: equal area does not imply the same country.

Distance and direction use one approximate reference point per country, rather than capitals, precise centres, or borders. One point cannot capture a large country or island group, or fully represent the territory covered by its population and land-area figures.

Distance follows the shortest route over a spherical Earth, using the haversine formula and a mean radius of 6,371.0088 km. Direction is its starting heading, rounded to eight compass directions. Long routes can bend toward the poles, so arrows may differ from a line on a flat map. Coincident points have no direction; country codes identify correct answers.

| Distance label | Reference-point distance |
| --- | --- |
| Very close | Under 500 km |
| Close | 500 to under 2,000 km |
| Nearby | 2,000 to under 5,000 km |
| Far | 5,000 to under 10,000 km |
| Very far | 10,000 km or more |

With Japan as the answer, Italy gives **↗ far · people ↑ · area ↑**; South Korea gives **→ close · people ↑ · area ↑**.

Starting hints come from an independently reviewed bank for all 195 countries. Four curated examples per country combine one name clue, one population or land-area clue, and two distinct geography clues; gameplay selects from every reviewed eligible alternative. Selection gives name clues and numerical clues roughly a quarter of rounds each, and geography roughly half. The round identity and saved previous-answer exclusions keep the selected hint fixed while guessing and when the board is resumed in another tab.

Eligibility is checked against the actual available round pool: at least four confirmed matches and no more than 70% possible matches. Every Medium and Hard hint must leave at least seven declared possible answers, more than the six-guess allowance, even when some matches are uncertain. A partial confirmed geography list must leave at least four; uncertain border and area scopes are included in its conservative possible set. Confirmed lists are not treated as exhaustive when additional countries may fit. Removing earlier answers can make a formerly usable clue ineligible, so counts are rechecked for every new round.

Name clues use the displayed English country name, with accents treated as ordinary letters. Spaces and hyphens do not count as letters. Vowels are A, E, I, O and U. Numerical clues use the same population and land-area snapshot as the guessing clues.

Geography clues use country-level facts, rather than the approximate reference points used for directions and distances. Sources include the mledoze border and landlocked fields, independent geographic references, UN regional classifications, and official country and UN publications. The review accounts for the Canada–Denmark land border established in 2022 and the Botswana–Zambia border, treats Hong Kong and Macao as part of China, and does not count a sea crossing as a land border. Ambiguous exact border counts are omitted. Island clues use separately checked geography; they are not inferred from an empty border list. Neighbor-size clues compare land area in this snapshot. Regional and ocean clues follow the conventions documented for each phrase.

Neighbour-size memberships include every positive comparison supported by the permitted border graph; a neighbour’s own uncertain border count does not make its known area unusable. Suriname’s French Guiana comparison remains uncertain where adjoining-territory and sovereign-France scopes could reverse the ordering. Pacific coast wording explicitly includes its seas. Ambiguous neighbour-continent and ocean-system phrases, programme-only Pacific island lists, and duplicate Caribbean shortlists are omitted from play. Regional wording includes North/Central America and the Caribbean explicitly, and uses a South-or-West-Asia union to avoid a surprising narrow label for Iran.

The [complete hint bank](starting-hints.json) preserves each phrase’s sources, confirmed and possible matches, difficulty eligibility, conventions, attribution, and the two independent review certificates. Its source and readable review lists are also saved under `research/starting-hints/` in the project. Runtime hints are generated only from the reviewed contents.

## Attribution and licences

The names and geography database is derived from mledoze/countries, © its contributors, under the **Open Database Licence 1.0 (ODbL)**. Ländle's derived databases in `data.js` and the starting-hint bank use the same licence; the upstream text is included in [DATA_LICENSE.txt](DATA_LICENSE.txt). Modifications include field selection, roster filtering, difficulty groups, aliases, replacement population and land-area figures, reviewed geography corrections, and derived hint assignments. Application code and styling are separate from the database.

World Bank, World Development Indicators, **SP.POP.TOTL (2024)** and **AG.LND.TOTL.K2 (2023)**, retrieved 3 October 2026. These indicators use **Creative Commons Attribution 4.0**, as shown on the [population](https://data.worldbank.org/indicator/SP.POP.TOTL) and [land-area](https://data.worldbank.org/indicator/AG.LND.TOTL.K2) pages. Vatican City figures are attributed to the official publications linked above.
