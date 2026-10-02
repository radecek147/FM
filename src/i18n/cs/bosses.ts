/**
 * Texty šéfů — klíče `bosses.<id>.name|rule|intro|defeat|death` (rule = pravidlo s `{param}`,
 * intro = hláška při příchodu, defeat = při porážce, death = hláška pitvy, když na šéfovi run skončí).
 */
import type { TextTree } from '../cs';

export const bosses = {} satisfies TextTree;
