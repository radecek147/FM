/**
 * Texty žolíků (legendary): `jokers.<id>.name|desc|flavor` + vlastní hlášky (`jokers.<id>.<klíč>`).
 * `{param}` dosadí UI z `params` definice a z `describe(self)` (src/content/jokers/legendary.ts).
 * Flavor bez uvozovek — UI ho vysází kurzívou v „…“ (vnořené uvozovky tedy ‚takhle‘).
 */
import type { TextTree } from '../../cs';

export const jokersLegendary = {
  forefather: {
    name: 'Praotec Čech',
    desc: 'První ruka každého kola ještě před skórováním zvýší úroveň zahrané kombinace o {levels} (zatím +{current|plural:úroveň,úrovně,úrovní}).',
    flavor: 'Z Řípu bylo vidět mléko, strdí a jednu poctivou Postupku.',
    settled: 'Tady se usadíme! Úroveň nahoru.',
  },
  libuse: {
    name: 'Kněžna Libuše',
    desc: 'Každá skórující dáma dá {xmult|x} mult; na konci kola promění {cards|plural:náhodnou kartu drženou,náhodné karty držené,náhodných karet držených} v ruce v dámu.',
    flavor: 'Vidím skóre veliké, jehož sláva hvězd se dotýká.',
    prophecy: 'Libuše věští: bude z toho dáma.',
  },
  blanik_knights: {
    name: 'Blaničtí rytíři',
    desc: '{xmult|x} mult, dokud skóre kola nedosáhne {pct} % cíle.',
    flavor: 'Vyjedou, až bude nejhůř. Na začátku kola je vždycky nejhůř.',
  },
  bruncvik_sword: {
    name: 'Bruncvíkův meč',
    desc: 'Při prvním zahození v kole zničí nejnižší zahozenou kartu a trvale získá +{xmult|x} mult (teď {current|x}).',
    flavor: 'Seká sám. Stačí říct: ‚Hlavy dolů!‘',
    cut: 'Sek! Meč je zase o kus ostřejší.',
  },
  faust: {
    name: 'Doktor Faust',
    desc: '{base|x} mult a navíc +{xmult|x} za každou korunu, kterou máš (nejvýš {max|x}).',
    flavor: 'Duši neprodal, jen ji dal do zástavy.',
  },
  krakonos: {
    name: 'Krakonoš',
    desc: 'Každá použitá pranostika zvýší úroveň své kombinace o {levels} navíc a dá +{money|money}.',
    flavor: 'Počasí si dělá sám. Úrovně taky.',
    weather: 'Krakonoš zahřměl: úroveň navíc.',
  },
  silly_honza: {
    name: 'Hloupý Honza',
    desc: 'Vysoká karta a Dvojice dávají {xmult|x} mult.',
    flavor: 'Ležel na peci, a stejně vyhrál princeznu.',
  },
  astro_clock: {
    name: 'Orloj',
    desc: '{first|x} mult v první ruce kola, {second|x} ve druhé a {later|x} v každé další.',
    flavor: 'Kostlivec zvoní, apoštolové kynou, skóre se násobí.',
  },
} satisfies TextTree;
