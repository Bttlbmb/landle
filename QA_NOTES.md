# Verification notes

These checks cover the game rules, country data, saved progress and the main browser interactions. Run them after changing the corresponding code. Automated checks can catch many regressions; they do not establish how every player or physical phone will experience the game.

On 5 October 2026, the cleanup passed all 87 unit tests, 41 Chromium browser scenarios and 18 keyboard scenarios each in WebKit and Chromium. The reviewed hint contents kept the same fingerprint. The unit suite fell from about 79 seconds to 1.4 seconds after removing repeated work from the checks. A local benchmark of 20,000 repeated hint selections fell from 1,318 ms to 27 ms with the pool already cached; this measures selection overhead, rather than the whole game.

## Game and data checks

The GitHub Pages branch export passed all 89 tests on 5 October 2026. Both `dist/` and `docs/` exports are checked for complete assets, generated reading pages, removal of obsolete files, and preservation of the previous export when inputs are missing. A browser check served the actual `docs/` files under `/landle/` at 390px and 1440px widths; guessing, Help links, data attribution, the licence page and return navigation passed without browser errors, failed requests or external asset requests.

```sh
npm test
npm run build
```

The tests check all country pairs, distance boundaries, direction, names and aliases, six-guess outcomes, journey progression, statistics counted once, and recovery from damaged or older saves. They also check the answer and hint cooldowns across 1,000 completed rounds, stable hints through guesses and saved progress, and adversarial exclusions that change a clue's breadth.

Runtime hints are compared with the complete reviewed bank and its content fingerprint. Name and numerical facts are checked independently of their stored memberships. Geography regressions include neighbour-size comparisons, Cyprus's region, the Southern Europe exclusion case and the North Sea group. These checks verify recorded memberships and rules; they do not independently establish every geographic fact.

Build checks cover the asset allowlist, generated reading pages, unchanged licence text, removal of obsolete exports, and preserving the previous export when inputs or reviews fail. Separate fact and fairness certificates are required for the exact hint contents.

## Browser checks

The optional suite needs Node.js 22 or newer and a Chromium browser. It uses a temporary browser profile and does not touch your own saved game.

```sh
npm run build
BROWSER_BIN='/path/to/chromium' npm run test:browser
```

It checks source and static export, phone-to-desktop layouts, keyboard and touch suggestions, international text composition, Help and answer filtering, wins and losses, journey resets, reloads, migration, shared tabs, unavailable storage, optional browser tools, forced colours and text spacing. It also checks that game assets load locally without external requests.

Keyboard scenarios model a reduced and panned visible viewport and an 80px accessory-bar reserve. They check that entry stays below the six-row board, that suggestions appear above entry, that touch selection works, and that keyboard padding disappears on dismissal.

For fractional viewport heights and repeated keyboard notifications in WebKit and Chromium, use the additional probe with an installed Playwright module:

```sh
PLAYWRIGHT_MODULE='/path/to/playwright' npm run test:keyboard
PROBE_ENGINE=chromium PLAYWRIGHT_MODULE='/path/to/playwright' npm run test:keyboard
```

The default engine is WebKit. Set `BROWSER_BIN` for a different Chromium executable. The probe checks 18 height/offset combinations per engine, field clearance, normal board flow and scrolling stability. Browser reports and screenshots go to `artifacts/audit/`; these generated files are ignored by Git.

## Fact and wording reviews

The current hint bank has separate [fact](research/starting-hints/revised-accuracy-review.json), [fairness](research/starting-hints/revised-fairness-review.json) and [wording](research/starting-hints/revised-player-review.json) reports. The first two were independent reviews of the recorded contents. The wording reviewer also helped draft some geography hints; that report is an editorial assessment.

The saved fairness audit covered 358,400 seeded selections and 7,020 target/exclusion combinations. Its original measurements are retained in compressed form. Review records contain the paths and fingerprints from their original run; they are historical evidence, not certification of later code changes. The [maintenance notes](research/starting-hints/README.md) explain how to repeat the audit for a candidate bank.

## Remaining checks and limits

After changing the interface, manually check invalid and repeated guesses, both endings, suggestions by touch and keyboard, Help focus, source links, long country names, phone rotation, and two tabs sharing a round. For a changed phone keyboard layout, also check a physical iPhone with its native keyboard and accessory controls.

Emulated keyboard measurements do not establish physical Safari behavior. A full screen-reader audit and representative human difficulty study have not been completed. Earlier saves cannot recover history that was never stored. The data also has limits: fixed population estimates, land area excluding water, and approximate geographic points. [Country data and clues](DATA_SOURCES.md) explains their effect on play.
