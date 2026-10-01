/** Texty žolíků — skládá skupiny z src/i18n/cs/jokers/*.ts (klíče `jokers.<id>.name|desc|flavor`). */
import { jokersCommon } from './jokers/common';
import { jokersEpic } from './jokers/epic';
import { jokersLegendary } from './jokers/legendary';
import { jokersRare } from './jokers/rare';
import { jokersSpecial } from './jokers/special';

export const jokers = {
  ...jokersCommon,
  ...jokersRare,
  ...jokersEpic,
  ...jokersLegendary,
  ...jokersSpecial,
};
