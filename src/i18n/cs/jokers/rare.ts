/** Texty žolíků (rare): `jokers.<id>.name|desc|flavor`. */
import type { TextTree } from '../../cs';

export const jokersRare = {
  late_train: {
    name: 'Zpožděný rychlík',
    desc: '{xmult|x} mult; {chance} {odds|z}, že efekt „nabere zpoždění“ a nenastane.',
    flavor: 'Mult přijede s mírným zpožděním.',
    delay: 'Zpoždění! Mult dorazí příště.',
  },
  head_waiter: {
    name: 'Pan vrchní',
    desc: '{xmult|x} mult, pokud zahraná ruka má nejvýš {cards|plural:kartu,karty,karet}.',
    flavor: 'Platím! – Za tři.',
  },
  old_guard: {
    name: 'Stará garda',
    desc: '{xmult|x} mult, pokud má zahraná kombinace úroveň aspoň {level}.',
    flavor: 'My to hráli, když byla Dvojice ještě na jedničce.',
  },
  herbalist: {
    name: 'Kořenářka',
    desc: 'Po každé použité babské radě trvale +{mult} mult (teď +{current} mult).',
    flavor: 'Na každou bolest bylinka, na každou bylinku mult.',
  },
  regular: {
    name: 'Stálý host',
    desc: '+{mult} mult za každé kolo, které od koupě strávil ve slotu (teď +{current} mult).',
    flavor: 'Má tu vlastní hrnek i vlastní židli.',
  },
  beer_belly: {
    name: 'Pivní břicho',
    desc: 'Po každé zahrané ruce trvale +{chips|plural:čip,čipy,čipů} (teď +{current|plural:čip,čipy,čipů}).',
    flavor: 'Tohle není břicho, to je dlouhodobá investice.',
  },
  carousel: {
    name: 'Kolotoč na pouti',
    desc: 'Postupka smí jít kolem dokola (např. Q-K-A-2-3) a každá Postupka dá +{mult} mult.',
    flavor: 'Točí se to dokola jako každý rok.',
  },
  echo: {
    name: 'Ozvěna z propasti',
    desc: 'Poslední skórující karta skóruje ještě {retriggers}×.',
    flavor: 'Haló! …haló …aló …ló …ó.',
  },
  lucky_seven: {
    name: 'Šťastná sedmička',
    desc: 'Každá skórující karta: {chance} {odds|z}, že skóruje ještě {retriggers}×.',
    flavor: 'Automat v nádražce sype jednou za čas. Zato pořádně.',
  },
  tab: {
    name: 'Sekera',
    desc: 'Můžeš jít do mínusu až −{debt|money}; +{mult} mult za každou korunu, která ti chybí do {cap|money}.',
    flavor: 'Zapište mi to. Čím míň v kapse, tím víc na tácku.',
  },
} satisfies TextTree;
