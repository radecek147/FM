/**
 * Názvy a popisy kombinací (DESIGN kap. 2.2) — klíče `hands.<type>.name|desc` podle `HandType`
 * z src/engine/types.ts. Test v tests/unit/i18n.test.ts hlídá, že žádná kombinace nechybí.
 */

/** Kombinace podle `HandType` z engine/types.ts (vč. tajných: Pětice, Barevný full house, Barevná pětice). */
export const hands = {
  high_card: {
    name: 'Vysoká karta',
    desc: 'Když nic jiného nevyjde, skóruje jen nejvyšší zahraná karta.',
  },
  pair: { name: 'Dvojice', desc: 'Dvě karty stejné hodnoty.' },
  two_pair: { name: 'Dvě dvojice', desc: 'Dvě Dvojice různých hodnot.' },
  three: { name: 'Trojice', desc: 'Tři karty stejné hodnoty.' },
  straight: {
    name: 'Postupka',
    desc: 'Pět karet po sobě jdoucích hodnot. Eso smí být nízké (A-2-3-4-5) i vysoké (10-J-Q-K-A).',
  },
  flush: { name: 'Barva', desc: 'Pět karet stejné barvy.' },
  full_house: { name: 'Full house', desc: 'Trojice a k tomu Dvojice jiné hodnoty.' },
  four: { name: 'Čtveřice', desc: 'Čtyři karty stejné hodnoty.' },
  straight_flush: { name: 'Postupka v barvě', desc: 'Postupka, ve které jsou všechny karty stejné barvy.' },
  royal_flush: { name: 'Královská postupka', desc: 'Postupka v barvě od desítky po eso (10-J-Q-K-A).' },
  five: { name: 'Pětice', desc: 'Pět karet stejné hodnoty. S obyčejným balíčkem to nepůjde.' },
  flush_house: { name: 'Barevný full house', desc: 'Full house, ve kterém jsou všechny karty stejné barvy.' },
  flush_five: { name: 'Barevná pětice', desc: 'Pětice, ve které jsou všechny karty stejné barvy.' },
};
