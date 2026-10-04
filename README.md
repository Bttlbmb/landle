# Ländle

Ländle is a country guessing game inspired by Wordle and Worldle. Find a hidden country in six guesses, using clues about direction, distance, population and land area. A journey has three rounds: **Easy → Medium → Hard**.

## Play

Type a country name and press **Guess**. Alternative spellings and two- or three-letter country codes also work. Suggestions help with partial names and distinguish countries such as the two Congos. Invalid or repeated guesses use no attempts.

Use the arrow keys to move through suggestions. Enter selects the highlighted country; a second Enter submits it. Escape closes the list. Guess submits an exact supported name or code directly.

Every clue describes the answer compared with your guess. If you guess France and the answer is Germany, the clues point northeast, show more people, and show less land. Direction follows the start of the shortest route around the globe. That can look surprising on a flat map.

A round opens with one reviewed hint that stays fixed while you guess. Name hints use the displayed English name: accents do not change letters, spaces and hyphens are not letters, and vowels are A, E, I, O and U. [Country data and clues](DATA_SOURCES.md) explains the other definitions and their limits.

Easy begins with 45 possible answers, Medium expands to 110, and Hard includes all 195 countries. You can guess any country at every difficulty. The last 12 finished answers are excluded; hint wording from the last six shown rounds is avoided when a suitable alternative exists. Help lists the actual available answers after these exclusions and the hint fairness checks.

Finish each round to move on, whether you find the country or use all six guesses. After Hard, start a new journey at Easy. Only finished rounds count toward statistics, once each; abandoning a round adds no loss.

## Saved progress

A normal visit resumes your saved board, including in another tab. **Reloading replaces an unfinished round** with a new country at the same difficulty. Reloading a finished round advances to the next one; after Hard, it begins a new journey. Statistics stay. An abandoned answer does not enter the answer cooldown, but its shown hint enters the hint history.

Progress belongs to this browser at this website address. Clearing browser data removes it; a different browser or address has separate progress. If storage is unavailable, the game continues without saving. Tabs share saved boards: an update to the same round keeps your typed draft, while a replacement round clears it.

Older version 1 saves keep their statistics and start a fresh Easy journey. Existing Journey saves recover their board and recent history where possible. Damaged rounds restart without clearing valid lifetime statistics; history missing from an old save cannot be reconstructed.

## Run and check

You need Node.js 20.11 or newer. There are no packages to install.

```sh
npm start
```

Open [localhost:5173](http://localhost:5173). This preview runs only on your computer. Set `PORT` to use another port. Open the game through a web server; opening the HTML file directly can prevent its JavaScript from loading.

```sh
npm test
npm run build
```

The build writes a complete static site to `dist/`, including the data and licence reading pages. It checks the hint reviews, generates the runtime hints, and replaces the previous export only after preparing all files. Keep source edits outside `dist/`. The game uses local assets and fixed data, without an account or external data service. The configured Sites workflow publishes this export; it can also be served by a static web host.

[Verification notes](QA_NOTES.md) explain the automated checks, optional browser checks and remaining limits.

## Maintain the project

| Files | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Board, input, Help, announcements and saved progress |
| `country-search.js` | Country names, aliases and code suggestions |
| `game-state.js` | Six-guess rules, journey progression, history and statistics |
| `geography.js`, `data.js` | Clue calculations and the fixed country snapshot |
| `hint-selection.js`, `starting-hints.js` | Fairness checks and generated playable hints |
| `starting-hints.json` | Complete hint bank, sources and review certificates |
| `DATA_SOURCES.md`, `DATA_LICENSE.txt`, `reading-pages.mjs` | Source documents and their generated reading pages |
| `research/starting-hints/` | Geography source facts, review records and hint tooling |
| `game-tools.js` | Optional browser tools using the visible game actions |
| `server.mjs`, `build.mjs`, `tests/` | Local preview, static export and verification |
| `fonts/`, `logo.svg`, `favicon.svg` | Local typeface, its licence and artwork |

Browse the [hint bank](research/starting-hints/index.html) in the local preview. It shows four examples per country and the wider set used in play.

To change hints, edit `research/starting-hints/geography.json` or the name and numerical rules in `assemble.mjs`, then run:

```sh
node research/starting-hints/assemble.mjs
node research/starting-hints/export.mjs --candidate
```

Assembly updates `starting-hints.json`. The candidate stays in the research folder. Changed facts, wording, rules or assignments need separate fact and fairness reviews for that exact content. Save their certificates in the two `revised-*-review.json` files, assemble again, then run `node research/starting-hints/export.mjs` and the checks. Both export and build reject missing, stale or duplicate certificates. See the [hint maintenance notes](research/starting-hints/README.md) for review tools and source provenance.

Edit `DATA_SOURCES.md` to change the data explanation. Preview and build generate its reading page, and the licence page, directly from their source documents. The Markdown reader supports paragraphs, headings, links, bold text, inline code and tables.

## Data and licences

The game covers the 193 United Nations members, Palestine and Vatican City. Population uses a 2024 snapshot; land area uses 2023 figures and excludes inland water. The country database uses [ODbL](DATA_LICENSE.txt); World Bank figures use CC BY 4.0. The Manrope font licence is in `fonts/`. These licences cover the data and font separately from application code and styling.
