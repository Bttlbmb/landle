# Ländle

Find a hidden country in six guesses, using direction, rough distance, population, and land-area clues. The game is inspired by Wordle and Worldle.

## Run locally

You need Node.js 20.11 or newer. There are no packages to install.

```sh
npm start
```

Open [localhost:5173](http://localhost:5173). The preview is available only on your computer; set `PORT` to use a different port.

To publish the game, run `npm run build` and upload the contents of `dist/` to a static web host. Each build replaces `dist/` with a clean export; keep source edits outside that folder. The game uses only static files and local assets, with no account or external service. Open it through a web server; directly opening `index.html` as a file can prevent its JavaScript from loading.

## Play

Enter a country name, supported alias, or two- or three-letter country code, then press **Guess**. Suggestions help with partial or ambiguous names such as “Congo” and “Korea”. Invalid and repeated guesses use no attempts.

Arrow keys move through suggestions, Enter selects the highlighted country, and a second Enter submits it. Escape closes the list. Guess can submit an exact name or code directly.

Every clue compares the answer with your guess: an upward population arrow means more residents. Direction and distance compare approximate country reference points along the shortest route around the globe. This can look surprising on a flat map. [Data sources](DATA_SOURCES.md) explains the calculations and limitations.

Each round opens with one reviewed hint from the full set of verified alternatives for its country. Selection balances name clues, population or land-area clues, and geography clues. The hint stays fixed while you guess. Wording from the last six shown rounds is avoided when an eligible alternative exists; otherwise the least recently shown eligible hint is used. Hints must leave at least four confirmed answers and match no more than 70% of the available round pool, after recent answers are excluded. On Medium and Hard, the entire declared possible set, including uncertain matches, must leave at least seven answers, so a six-guess round cannot simply exhaust its shortlist.

The [starting-hint bank](research/starting-hints/index.html) covers all 195 countries and is used in the game. It shows four curated examples per country: one name clue, one population or land-area clue, and two distinct geography clues, with the wider alternatives available to browse. Open it locally at `/research/starting-hints/index.html`, or read the [plain example list](research/starting-hints/hints.txt). The [complete bank](starting-hints.json) includes sources, every playable alternative, and eligibility for each difficulty; it also ships with the static export. Independent [fact](research/starting-hints/revised-accuracy-review.json) and [fairness](research/starting-hints/revised-fairness-review.json) reviews, plus a [player wording review](research/starting-hints/revised-player-review.json), are saved alongside the source bank.

Every **Journey** has three rounds: **Easy → Medium → Hard**, with six guesses per country. Each finished round advances to the next difficulty, whether won or lost. The answer pool grows from 45 to 110 to all 195 countries. Any country can be guessed in every round. The last 12 finished answers are excluded across journeys. Help lists the actual available answers after these exclusions and hint eligibility checks. After Hard, start a new journey at Easy.

**Reloading restarts an unfinished round** with a fresh country at the same difficulty. If the round is finished, reloading advances to the next round; after Hard, it starts a new journey at Easy. Statistics remain. Abandoned answers do not enter the 12-answer cooldown; their shown hints enter the six-round hint history. Opening the game normally, including in another tab, resumes the saved board.

Only completed rounds count toward statistics, once each. Abandoning a round adds no loss. When a round ends, choose **Start a new round** to continue, or **Start a new journey** after Hard. Version 1 progress migrates to a fresh Easy journey while keeping lifetime statistics. Existing Journey saves keep their board, guesses and statistics and gain recent history from the rounds still present in the save.

Progress stays in this browser at this website address. Clearing browser data removes it; another browser or address has a separate history. If browser storage is unavailable, play continues without saving. Tabs share boards: replacing a round clears old typed guesses; updates to the same round keep them.

## Code and checks

| Files | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Board, dialogs, and responsive layout |
| `data-sources.html`, `licence.html`, `reading-pages.css` | Responsive reading pages; original Markdown and licence text remain available for download |
| `app.js` | Interface, input, saved progress, and announcements |
| `country-search.js` | Country, alias, and code suggestions |
| `game-state.js` | Puzzles, six-guess rules, statistics, and Journey progression |
| `geography.js`, `data.js` | Clue calculations and embedded country snapshot |
| `hint-selection.js` | Stable hint selection and fairness against the saved round pool |
| `starting-hints.js`, `starting-hints.json` | Reviewed hints used by the game and their full provenance |
| `game-tools.js` | Optional browser tools using the visible game actions |
| `server.mjs`, `build.mjs` | Local preview and static export |
| `fonts/`, `logo.svg`, `favicon.svg` | Local typefaces, their licences, and game artwork |

Run `npm test` for the automated checks. [QA notes](QA_NOTES.md) describes coverage, browser checks, and remaining limits.

After editing the source facts, run `node research/starting-hints/assemble.mjs`. `node research/starting-hints/export.mjs --candidate` makes a research-only candidate for evaluation. After both independent reviews pass for the exact bank contents, assemble again and run `node research/starting-hints/export.mjs` to regenerate the game’s runtime files. The same selector evaluates the candidate and serves the reviewed export.

## Data and licences

The game includes the 193 United Nations members, Palestine, and Vatican City. Population uses a 2024 snapshot; land area uses 2023 figures and excludes inland water. [Data sources](DATA_SOURCES.md) records provenance, definitions, and exceptions.

The country database uses ODbL, included in [DATA_LICENSE.txt](DATA_LICENSE.txt). World Bank figures use CC BY 4.0. Font licences are in `fonts/`. These cover the data and fonts, separately from application code and styling.
