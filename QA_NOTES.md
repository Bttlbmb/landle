# Verification notes

Reviewed **4 October 2026**. The checks below can be repeated after changes.

## Automated checks

Run `npm test`. The checks cover all country pairs, compass directions and distance boundaries, names and aliases, starting-hint accuracy, breadth and stability, six-guess endings, the three-round Journey on wins and losses, exactly-once statistics, and recovery from malformed saved data. Hint checks verify all runtime alternatives against the exact independently reviewed bank and retain four distinct examples per country. They independently check name and numerical facts, confirmed and maximum counts, every Medium/Hard possible set above six answers, and selection reachability. Regressions cover omitted neighbour-size memberships, Cyprus’s revealed region, and prior-answer exclusions that would otherwise leave Spain alone in Southern Europe or reduce the North Sea group to six or fewer possible answers, including uncertain Sweden. Storage checks cover immutable saved exclusions, legacy hydration, malformed context, statistics, completed-prefix validation, and stable round identities for tab updates.

Answer and hint cooldown checks run 1,000 completed rounds across journeys, with wins, losses and restoration between rounds. They also cover the exact 12-answer window, six shown hints including reloads, oldest-eligible fallback, adversarial exclusions, fixed hints during guessing, and legacy Journey hydration. Historical rounds absent from older saves cannot be reconstructed.

Run `npm run build` to export the static game. The export should contain only runtime files, local assets, data attribution, and licence notices. It requires no external fonts or data requests.

## Browser checks

The optional browser suite requires Node.js 22 or newer and a Chromium executable. Preview, unit tests, and build still support Node.js 20.11 or newer.

```sh
npm run build
BROWSER_BIN=/path/to/chromium npm run test:browser
```

It starts a local preview and an isolated browser, without using your saved game history. Results are saved in [browser-results.json](artifacts/audit/browser-results.json).

The latest run passed 82 automated tests and 41 browser scenarios, including 16 consecutive browser rounds across journey resets. Browser coverage includes 11 viewport layouts, keyboard and touch input, starting a new round from results, Easy → Medium → Hard on wins and losses, a fresh Journey after Hard, shared-tab updates, reload behavior, older-save migration, unavailable storage, optional browser tools, forced colours, text spacing, and the static export. Three representative screenshots accompany the results. Checks also verify the compact header and introduction, approved introductory sentence, locally loaded Manrope, every reviewed Japan alternative across the eligible difficulties, stable hints during guessing and tab updates, saved previous-answer exclusions, Help’s available answer list, the Spain and North Sea history regressions, removed mode and statistics controls, the absence of the top slogan and Journey footer, quiet round starts, the longest hint on narrow phones, name-hint conventions in Help, and data-source and licence links. The static export includes the reviewed selector, runtime hints and full source bank, and the game makes no external requests.

The revised bank has separate [accuracy](research/starting-hints/revised-accuracy-review.json), [fairness](research/starting-hints/revised-fairness-review.json) and [player wording](research/starting-hints/revised-player-review.json) reports. Accuracy and fairness passed independently for the exact exported bank and shared selector; the wording reviewer declares earlier drafting involvement. The independent fairness audit checked 358,400 seeded selections and 7,020 target/exclusion combinations, with no singleton phrases or Medium/Hard possible sets of six or fewer surviving. Its raw frequencies and scope are saved in the research folder. These are mechanical and editorial checks, not a measured human win rate.

After interface changes, check both the preview and static export:

- Valid, invalid, repeated, winning, and losing guesses; three clue groups after each wrong guess.
- Keyboard and touch suggestions, ambiguous names, Escape, and text composition through international keyboards.
- Easy → Medium → Hard after each finished round, a fresh Journey after Hard, saved-board resume, and fresh rounds on reload without losing lifetime statistics.
- Two tabs sharing a board: retain a typed draft for an update to the same round and clear it when the round is replaced.
- Help, possible-answer lists, dialog focus, data-source links, and the single action to start a new round after a result.
- Narrow phones, landscape phones, tablets, and desktop windows; long country names and finished boards must remain readable without horizontal scrolling.
- An unchanged round at a new local day, older-save migration, and play when browser storage is unavailable.

## Responsive implementation · 4 October 2026

Implemented the accepted review proposals: readable Sources/Licence pages, phone search space and full-form suggestions, gradual 480–767px tablet proportions, hint-first touch round starts and rotation context, intact clue words under text spacing, and phone Help filtering with visible results. The local hint-bank page uses a compact sticky search and consistently normalized searches. The compact landscape board and enlarged tablet control targets were excluded; all six board slots remain.

[Responsive evidence](artifacts/responsive-implementation-2026-10-04/verification.html) includes 126 screenshot states across 22 viewports and 192 passing checks. Ten pixel comparisons at 1440×900 and 1920×1080 cover empty, long-name, search, Help and result states with zero changed pixels. Those comparisons use the saved original layout with the current runtime so concurrent hint-bank wording and selection changes are held constant. The 640/641px transition is checked at both 960px and 700px heights. Tablet input, option, disclosure and Close dimensions retain their previous values. A reduced-height viewport is only a keyboard proxy; native keyboard behavior still requires a physical-device check.

The browser suite additionally checks country-code filtering, filter/result visibility inside the dialog, restoring the full answer list after rotation, touch round context, and retaining a typed draft while revealing the latest clue. The export includes the two reading pages and their stylesheet. Keep each reading-page article synchronized with its original source document when changing attribution or licence text.

## Mobile keyboard visibility · 4 October 2026

The guess field now reveals its working area on touch focus and typing. When a keyboard shrinks the visual viewport while leaving the layout viewport tall, temporary body padding supplies the missing scroll range. Visual viewport resize and pan events keep the field, Guess action and suggestions within the visible area; the spacer is removed when the keyboard is dismissed. Browser chrome changes and pinch zoom do not receive keyboard padding.

The new regression reproduced the hidden entry on the previous code. Eight passing scenarios cover 320, 375, 390 and 430px phones in both source and static export, with 240–400px visible keyboard viewports. They check the empty focused entry, visible suggestions, scrolling and selecting the last option using touch events without Enter, subsequent typing, viewport panning, and spacer removal. All 37 browser scenarios pass without runtime errors, including the existing rotation, dialog, journey and desktop checks. Screenshots and results are saved in `artifacts/audit/`.

These tests emulate the viewport geometry reported by an overlay keyboard in isolated Chromium. They do not launch a native iPhone keyboard or establish physical Safari behavior; that remains a device verification step.

## iOS accessory-bar correction · 5 October 2026

The screenshot exposed a gap in the first keyboard fix: a single matching country could still fit below the input according to viewport measurements, so the list opened beneath it and an iOS accessory bar intercepted the tap. Touch suggestions now always open above entry, including short and empty-result lists. CSS provides the same placement before JavaScript positioning; working-area scrolling reserves suggestion space above the form. Desktop placement still chooses the side with room.

Four new source/export scenarios reproduce `Netherl` with an 80px accessory-bar overlay at 320 and 390px widths. The source cases retain two previous guesses, matching the reported board state. The old implementation failed the 390px case. The correction checks a visible Netherlands row above the input, hit testing against the overlay, and selection through real touch events without Enter. Evidence is in `artifacts/audit/accessory-*.jpg` and `browser-results.json`. These remain isolated Chromium simulations, not physical iPhone verification.

## Keyboard scrolling investigation · 5 October 2026

The next device report found the empty entry behind the accessory bar and rapid scrolling after the first letter. A dedicated probe reproduced entry overlap in all 18 viewport cases in both WebKit 26.5 and Chromium. The previous accessory-bar test placed its overlay below the form, so it did not test whether the field itself could be covered. The sustained physical-device flicker was not reproduced: the desktop engines with controlled keyboard metrics produced at most one WebKit or two Chromium page-scroll calls after typing. Code inspection found that visual-viewport scroll events called the page-scrolling reveal function, providing a feedback path that the static viewport tests did not exercise fully.

Keyboard entry now uses a fixed form positioned within the visual viewport, with an 80px reserve for accessory controls. A placeholder retains the form's normal board space. Keyboard layout updates and viewport scroll events reposition the form and list without scrolling the document. The body-padding workaround is removed. Normal layout returns when the keyboard closes; round results and landscape rotation retain their existing behavior.

`research/keyboard-reproduction-2026-10-05/probe.mjs` records original and revised behavior. `BASELINE=1` serves the original JS/CSS from the exact published commit without reverting local work. `ASSERT_STABLE=1` checks field clearance and zero page-scroll calls, including 60 consecutive pairs of viewport scroll/resize notifications. Run with `PLAYWRIGHT_MODULE` pointing to an installed Playwright module; `PROBE_ENGINE=chromium` selects Google Chrome, otherwise it uses an installed WebKit browser. Saved `before-*.json` and `after-*.json` contain measurements and scroll traces.

All 36 stability scenarios pass across the two engines, covering fractional visible heights from 240 to 400.5px and offset positions from 0 to 120.125px. Revised entry overlap is zero and application-driven page-scroll calls are zero. The 41 existing browser scenarios also pass. These runs emulate keyboard viewport metrics; they do not open a native iPhone keyboard or establish that physical Safari's flicker is resolved.

## Limits

Browser emulation can reveal layout and interaction problems, but it does not establish behavior on every physical phone. The game uses accessible names, keyboard controls, and clue announcements; this review is not a complete screen-reader audit. Automated checks do not establish a representative human win rate or prove the difficulty groups suit every player.

The clues also inherit limits from the data: historical population estimates, land area excluding inland water, and one approximate reference point per country. [Data sources](DATA_SOURCES.md) explains how these choices can affect a guess.
