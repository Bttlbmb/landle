import { createHintSelector } from '../../hint-selection.js';
import { STARTING_HINTS, HINT_RULES } from './candidate-hints.js';

export const { openingHintsFor, openingHint, chooseOpeningHint } = createHintSelector(STARTING_HINTS, HINT_RULES);
