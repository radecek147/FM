/**
 * Hlášky, které emituje engine (bubliny ve skórování, události `message`, `jokerTriggered`).
 * Klíče = hodnoty `MSG` v src/engine/constants.ts — test hlídá, že žádná nechybí.
 * Jmenné prostory v jednotném čísle (`joker`, `boss`, `tag`) jsou obecné hlášky; množné (`jokers.<id>`)
 * patří obsahu podle id.
 */

/** Bubliny během skórování ruky. */
export const score = {
  again: 'A ještě jednou!',
  debuffed: 'Mimo provoz.',
  glassBreak: 'Cink! A je po kartě.',
  lucky: 'Štístko!',
  luckyMoney: 'Výhra v loterii!',
  worn: 'Zase o kus ohmatanější.',
  bossAdjusted: 'Šéf to přepočítal po svém.',
};

/** Obecné hlášky šéfů. */
export const boss = {
  disabled: 'Šéf odešel na oběd. Jeho pravidlo dneska neplatí.',
};

/** Obecné hlášky žolíků. */
export const joker = {
  saved: 'Na poslední chvíli! Kolo se počítá.',
  perished: 'Zvětral. Jako pivo, co zůstalo přes noc na stole.',
  rentalReturned: 'Poplatek nezaplacen – žolík se vrací do půjčovny.',
};

/** Obecné hlášky štítků. */
export const tag = {
  saved: 'Štítek zachránil kolo. Odměna za útratu ale propadá.',
};
