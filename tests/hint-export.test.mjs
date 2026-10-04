import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHintBank, hintRuntimeSource } from '../research/starting-hints/export.mjs';

async function fixture(t, bank) {
  const root = await mkdtemp(join(tmpdir(), 'landle-hint-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'starting-hints.json'), JSON.stringify(bank));
  return root;
}

test('export requires distinct fact and fairness certificates for the exact contents', async t => {
  const bank = await loadHintBank();
  const root = await fixture(t, { ...bank, reviews: [bank.reviews[0], bank.reviews[0]] });
  await assert.rejects(loadHintBank(root), /Both fact and fairness certificates/);
  await writeFile(join(root, 'starting-hints.json'), JSON.stringify(bank));
  await mkdir(join(root, 'research/starting-hints'), { recursive: true });
  for (const review of bank.reviews) {
    await writeFile(join(root, 'research/starting-hints', review.file),
      JSON.stringify({ status: 'passed', reviewedContentSha256: 'stale' }));
  }
  await assert.rejects(loadHintBank(root), /review/);
});

test('candidate export rejects content tampering and derives the exact certified assignments', async t => {
  const bank = await loadHintBank();
  const source = hintRuntimeSource(bank);
  assert.equal(source, await readFile(new URL('../starting-hints.js', import.meta.url), 'utf8'));
  const changed = structuredClone(bank);
  changed.catalog[0].text += ' changed';
  const root = await fixture(t, changed);
  await assert.rejects(loadHintBank(root, { candidate: true }), /changed since review/);
  const wrongAssignments = structuredClone(bank);
  wrongAssignments.countries[0].alternatives.reverse();
  assert.throws(() => hintRuntimeSource(wrongAssignments));
});
