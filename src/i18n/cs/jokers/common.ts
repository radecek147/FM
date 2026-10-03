/**
 * Texty žolíků (common): `jokers.<id>.name|desc|flavor` + vlastní hlášky (`jokers.<id>.<klíč>`).
 * `{param}` dosadí UI z `params` definice a z `describe(self)` (src/content/jokers/common.ts).
 * Flavor bez uvozovek — UI ho vysází kurzívou v „…“.
 */
import type { TextTree } from '../../cs';

export const jokersCommon = {
  beer_mat: {
    name: 'Pivní tácek',
    desc: '+{chips|plural:čip,čipy,čipů} a +{mult} mult. Jako jediný žolík se smí v nabídce opakovat.',
    flavor: 'Každá čárka se počítá.',
  },
  hearts_man: {
    name: 'Srdcař',
    desc: 'Každá skórující srdcová karta dá +{chips|plural:čip,čipy,čipů} a +{mult} mult.',
    flavor: 'Srdce na dlani, peněženku v kapse.',
  },
  gravedigger: {
    name: 'Hrobník',
    desc: 'Každá skórující piková karta dá +{chips|plural:čip,čipy,čipů}.',
    flavor: 'Jeho zákazníci si nikdy nestěžují. Ani na čekací dobu.',
  },
  jeweler: {
    name: 'Klenotník',
    desc: 'Každá skórující kárová karta trvale získá +{chips|plural:čip,čipy,čipů}.',
    flavor: 'Briliant od skla pozná na první pohled. Cenu ti řekne až na druhý.',
    polished: 'Vyleštěno!',
  },
  crusader: {
    name: 'Křižák',
    desc: '+{mult} mult, pokud {count|word:skóruje,skórují,skóruje} aspoň {count|plural:křížová karta,křížové karty,křížových karet}.',
    flavor: 'Na výpravu se nechodí sám.',
  },
  early_bird: {
    name: 'Ranní ptáče',
    desc: 'První ruka kola dá +{mult} mult.',
    flavor: 'Kdo dřív přijde, ten dřív skóruje.',
  },
  night_shift: {
    name: 'Noční směna',
    desc: 'V kole se šéfem dá každá ruka +{mult} mult.',
    flavor: 'Po půlnoci platí noční tarif. A šéf chodí na kontrolu.',
  },
  meteorologist: {
    name: 'Meteorolog',
    desc: '+{mult} mult za každou úroveň zahrané kombinace nad první.',
    flavor: 'Zítra polojasno, místy přeháňky bodů.',
  },
  pe_teacher: {
    name: 'Tělocvikář',
    desc: '+{chips|plural:čip,čipy,čipů} za každou zahranou kartu, i za neskórující.',
    flavor: 'Nastoupit do řady, i s omluvenkou!',
  },
  party_for_two: {
    name: 'Párty pro dva',
    desc: '+{chips|plural:čip,čipy,čipů} a +{mult} mult, pokud zahraná ruka obsahuje Dvojici.',
    flavor: 'Do páru se to táhne líp.',
  },
  gardener: {
    name: 'Zahrádkář Venca',
    desc: 'Na konci kola +{money|money} za {cards|word:každou,každé,každých} {cards|plural:kartu drženou,karty držené,karet držených} v ruce.',
    flavor: 'Kompost nelže.',
  },
  svejk: {
    name: 'Švejk',
    desc: 'Po ruce za méně než {pct} % cíle kola získáš +{discards} zahození, nejvýš {max}× za kolo (teď ještě {left}×).',
    flavor: 'Poslušně hlásím, že to byl taktický ústup.',
    report: 'Poslušně hlásím: +{discards} zahození.',
  },
  piggy_bank: {
    name: 'Pokladnička',
    desc: 'Na konci kola +{money|money}. Po {rounds}. kole se rozbije, dá ještě {bonus|money} a zmizí ({left|word:zbývá,zbývají,zbývá} {left|plural:kolo,kola,kol}).',
    flavor: 'Kladívko je přivázané na provázku.',
    broken: 'Cink! Pokladnička je na střepy.',
  },
  flea_trader: {
    name: 'Bazarník',
    desc: 'Na konci kola +{money|money} za každý prázdný slot žolíka.',
    flavor: 'Prodám všechno, i ten regál.',
  },
  golem: {
    name: 'Golem',
    desc: 'Při získání přidá do balíčku {cards|plural:kamennou kartu,kamenné karty,kamenných karet}; každá skórující kamenná karta dá +{chips|plural:čip,čipy,čipů} navíc.',
    flavor: 'Šém mu vložili, návod nikdo.',
  },
} satisfies TextTree;
