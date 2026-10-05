/** Optional browser tools use exactly the same actions as the visible game. */
export function registerGameTools({ getBoard, guessCountry, nextCountry }, context = globalThis.document?.modelContext) {
  if (typeof context?.registerTool !== 'function') return;
  const lifecycle = new AbortController();
  const tools = [
    {
      name: 'get_landle_board',
      title: 'Read the Ländle board',
      description: 'Read the current round of the three-round Easy, Medium, Hard journey, its reviewed starting hint, guesses, and visible clues. The hidden country is returned only after the round ends.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => getBoard(),
    },
    {
      name: 'submit_landle_guess',
      title: 'Guess a country in Ländle',
      description: 'Submit one country guess in the current round. A valid new guess uses one of six attempts and displays direction, rough distance, population, and land-area clues. Invalid or repeated countries use no attempts.',
      inputSchema: {
        type: 'object',
        properties: { country: { type: 'string', minLength: 1, maxLength: 100 } },
        required: ['country'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            typeof input.country !== 'string' || !input.country.trim() || input.country.length > 100 ||
            Object.keys(input).some(key => key !== 'country')) {
          return { error: 'Provide one country name.' };
        }
        return guessCountry(input.country);
      },
    },
    {
      name: 'advance_landle_journey',
      title: 'Continue your Ländle journey',
      description: 'After the current round ends, advance from Easy to Medium to Hard regardless of whether the country was found. After Hard, start a new three-round journey at Easy. Unfinished rounds cannot be replaced.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => nextCountry(),
    },
  ];
  // Registration is optional; unsupported or rejecting browsers must not break play.
  for (const tool of tools) {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {}
  }
  return () => lifecycle.abort();
}
