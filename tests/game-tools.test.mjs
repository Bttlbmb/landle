import test from 'node:test';
import assert from 'node:assert/strict';
import { registerGameTools } from '../game-tools.js';

function actions() {
  const calls = [];
  return {
    calls,
    getBoard: () => ({ round: 1, totalRounds: 3, level: 'Easy', guesses: [] }),
    guessCountry: country => { calls.push(country); return { accepted: true }; },
    nextCountry: () => ({ continued: true }),
  };
}

test('optional browser tools are harmless when unsupported or registration fails', async () => {
  const game = actions();
  assert.equal(registerGameTools(game), undefined);
  assert.equal(registerGameTools(game, { registerTool: true }), undefined);
  assert.doesNotThrow(() => registerGameTools(game, { registerTool() { throw new Error('unsupported'); } }));
  registerGameTools(game, { registerTool() { return Promise.reject(new Error('unsupported')); } });
  // Give rejected registrations time to settle; node:test detects unhandled rejections.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(game.calls, []);
});

test('tools share visible-game actions and can be removed together', () => {
  const game = actions();
  const tools = new Map();
  const signals = [];
  const dispose = registerGameTools(game, {
    registerTool(tool, { signal }) { tools.set(tool.name, tool); signals.push(signal); },
  });
  assert.equal(tools.size, 3);
  assert.deepEqual(tools.get('get_landle_board').execute(), game.getBoard());
  assert.deepEqual(tools.get('advance_landle_journey').execute(), { continued: true });
  assert.deepEqual(tools.get('submit_landle_guess').execute({ country: 'France' }), { accepted: true });
  assert.deepEqual(game.calls, ['France']);
  assert.ok(signals.every(signal => !signal.aborted));
  dispose();
  assert.ok(signals.every(signal => signal.aborted));
});

test('tool guesses reject malformed inputs before consuming an attempt', () => {
  const game = actions();
  let guess;
  registerGameTools(game, { registerTool(tool) { if (tool.name === 'submit_landle_guess') guess = tool; } });
  for (const input of [undefined, null, 1, 'France', [], {}, { country: 1 }, { country: ' ' },
    { country: 'a'.repeat(101) }, { country: 'France', answer: 'Japan' }]) {
    assert.deepEqual(guess.execute(input), { error: 'Provide one country name.' });
  }
  assert.deepEqual(game.calls, []);
});
