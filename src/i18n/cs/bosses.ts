/**
 * Texty šéfů — klíče `bosses.<id>.name|rule|intro|defeat|death` (rule = pravidlo s `{param}`,
 * intro = hláška při příchodu, defeat = při porážce, death = hláška pitvy, když na šéfovi run skončí).
 * Skupiny v src/i18n/cs/bosses/*.ts.
 */
import { bossesA } from './bosses/a';
import { bossesB } from './bosses/b';
import { bossesFinal } from './bosses/final';

export const bosses = { ...bossesA, ...bossesB, ...bossesFinal };
