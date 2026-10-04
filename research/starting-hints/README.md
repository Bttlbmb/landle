# Maintaining starting hints

`../../starting-hints.json` is the single complete bank. It records the facts, wording, country assignments, fairness rules, sources and review certificates. `../../starting-hints.js` is its smaller generated form for the game. The local [browser](index.html) reads the complete bank directly.

## Sources and assembly

`geography.json` contains the country records and geographic fact groups used by the current bank and `assemble.mjs`. Retired proposals and earlier draft counts have been removed. Name and numerical groups are generated from the displayed country names and fixed figures in `../../data.js`.

`upstream-countries.json.gz` preserves the exact downloaded country snapshot, compressed without changing its bytes. Assembly decompresses it to retain the original source fingerprint. Read it with a gzip reader or `gzip -dc upstream-countries.json.gz`.

Run commands from the repository root:

```sh
node research/starting-hints/assemble.mjs
node research/starting-hints/export.mjs --candidate
```

Assembly requires the source facts and snapshot. It updates the complete bank; candidate export creates an ignored `candidate-hints.js` for review. `candidate-selection.js` uses the same selection code as the game.

## Review and export

Changed rules, facts, wording or assignments change the bank's content fingerprint. Separate fact and fairness reviews must pass for that exact content before it can be exported. The two certificate files are `revised-accuracy-review.json` and `revised-fairness-review.json`. The player wording report is useful editorial evidence and records its drafting involvement.

For an additional mechanical fairness audit, replace `CONTENT_HASH` below with the bank's `contentSha256` value:

```sh
node research/starting-hints/revised-fairness-audit.mjs --run --expected-hash CONTENT_HASH
node research/starting-hints/revised-fairness-lifecycle-audit.mjs --expected-hash CONTENT_HASH
```

The first compares candidate selections and independently reconstructed name/numerical memberships; it saves compressed measurements. The second checks state recovery and exclusion cases. Its state checks use the currently exported bank, so run it after exporting the reviewed contents when checking a new bank's integration. Neither script supplies an independent editorial verdict.

After both reviews pass, assemble again, then export and verify:

```sh
node research/starting-hints/assemble.mjs
node research/starting-hints/export.mjs
npm test
npm run build
```

Export and build verify the exact pair of certificates and their content fingerprints. They also check that deriving country assignments from phrase memberships reproduces the reviewed lists in order. Build generates its own runtime file, so a stale local export cannot enter the published site.

## Retained evidence

The original current-bank review reports and fairness measurements are retained without rewriting their judgments. Their recorded paths and source-file fingerprints describe the original review run; files have since been consolidated or compressed. The bank's content fingerprint is unchanged by this cleanup. Git history retains removed versioned drafts, reviews and migration code.
