/*
 * Repère local commun aux tests : toute graine passe par un repère
 * (`core/groundSeed.js`), et un faux repère vide ne sait pas en tirer.
 */
import { createLocalFrame } from '../src/core/tileMath.js';

export const testFrame = createLocalFrame(-0.145, 47.131, 15);
