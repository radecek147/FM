/** Texty žolíků — skládá skupiny z src/i18n/cs/jokers/*.ts (klíče `jokers.<id>.name|desc|flavor`). */
import { jokersCommon } from './jokers/common';
import { jokersCommon2 } from './jokers/common2';
import { jokersEpic } from './jokers/epic';
import { jokersEpic2 } from './jokers/epic2';
import { jokersLegendary } from './jokers/legendary';
import { jokersRare } from './jokers/rare';
import { jokersRare2 } from './jokers/rare2';
import { jokersSpecial } from './jokers/special';

export const jokers = {
  ...jokersCommon,
  ...jokersCommon2,
  ...jokersRare,
  ...jokersRare2,
  ...jokersEpic,
  ...jokersEpic2,
  ...jokersLegendary,
  ...jokersSpecial,
};
