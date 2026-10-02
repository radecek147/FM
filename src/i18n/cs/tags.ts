/**
 * Texty štítků za přeskočení — klíče `tags.<id>.name|desc|flavor` (definice v src/content/tags.ts, docs/DESIGN.md
 * kap. 7). Čísla jen přes `{param}` z `TagDef.params`, u čísla se slovem s `|plural:`; flavor bez uvozovek.
 */
import type { TextTree } from '../cs';

export const tags = {
  coat_change: {
    name: 'Drobné v kabátě',
    desc: 'Dostaneš {money|money}.',
    flavor: 'Z loňské zimy, ještě s účtenkou.',
  },
  term_deposit: {
    name: 'Termínovaný vklad',
    desc: 'Po porážce šéfa tohoto patra dostaneš {money|money} navíc v rozpisu odměn.',
    flavor: 'Výběr před splatností zpoplatněn.',
  },
  advance_payment: {
    name: 'Zálohy',
    desc: '+{money|money} za každou útratu přeskočenou v tomto runu (včetně této).',
    flavor: 'Doplatek přijde v březnu.',
  },
  hop_picking: {
    name: 'Brigáda na chmelu',
    desc: '+{money|money} za každé {hands|plural:ruka,ruce,rukou} zahrané v tomto runu (nejvýš +{cap|money}).',
    flavor: 'Za dědy povinná, dnes aspoň placená.',
  },
  open_doors: {
    name: 'Otevřené dveře',
    desc: 'V příští Večerce máš {rerolls|plural:přehození,přehození,přehození} zdarma.',
    flavor: 'Den otevřených dveří: vstup i přehazování zdarma.',
  },
  uncle_envelope: {
    name: 'Obálka od strýce',
    desc: 'Hned otevřeš zdarma Tlustou obálku žolíků.',
    flavor: 'Na zub. A nic neříkej mámě.',
  },
  kiosk_calendar: {
    name: 'Kalendář z trafiky',
    desc: 'Hned otevřeš zdarma Tlustou obálku pranostik.',
    flavor: 'S hasičskými motivy, jako každý rok.',
  },
  grandma_parcel: {
    name: 'Balík od babičky',
    desc: 'Hned otevřeš zdarma Tlustou obálku babských rad.',
    flavor: 'Buchty, ponožky a dobré rady.',
  },
  official_letter: {
    name: 'Úřední dopis',
    desc: 'Hned otevřeš zdarma Obálku razítek.',
    flavor: 'Do vlastních rukou. Bohužel.',
  },
  cottage_marias: {
    name: 'Mariáš na chalupě',
    desc: 'Hned otevřeš zdarma Tlustou obálku hracích karet.',
    flavor: 'Hraje se do tmy a o drobné.',
  },
  polished_cutlery: {
    name: 'Vyleštěné příbory',
    desc:
      'Příští žolík ve Večerce dostane náhodnou edici (lesklá {foil} %, holografická {holo} %, duhová {poly} %) ' +
      'bez příplatku.',
    flavor: 'Na návštěvu se vytahuje to nejlepší.',
  },
  photo_negative: {
    name: 'Fotonegativ',
    desc: 'Příští žolík ve Večerce bude negativní, bez příplatku.',
    flavor: 'Z alba, kde všichni vypadají jako duchové.',
  },
  referral: {
    name: 'Doporučení od známého',
    desc: 'V příští Večerce navíc slot se vzácným žolíkem o {pct} % levněji.',
    flavor: 'Řekni, že jdeš ode mě.',
  },
  connections: {
    name: 'Protekce',
    desc: 'V příští Večerce navíc slot s epickým žolíkem (za plnou cenu).',
    flavor: 'Nejde o to, co umíš, ale koho znáš.',
  },
  voucher_slip: {
    name: 'Úřední poukaz',
    desc: 'V příští Večerce navíc {vouchers|plural:kupón,kupóny,kupónů}.',
    flavor: 'Platí do konce měsíce. Kterého, neuvedeno.',
  },
  boss_flu: {
    name: 'Šéf má chřipku',
    desc: 'Cíl šéfa tohoto patra je o {pct} % nižší.',
    flavor: 'Omluvenka od doktora, podpis nečitelný.',
  },
  spread_newspaper: {
    name: 'Rozložené noviny',
    desc: 'V příštím kole +{handSize|plural:karta,karty,karet} v ruce a +{discards} zahození.',
    flavor: 'Kdo čte noviny, má přehled. A víc místa na stole.',
  },
  forecast: {
    name: 'Předpověď počasí',
    desc:
      'Tvoje nejčastěji hraná kombinace v runu dostane +{levels|plural:úroveň,úrovně,úrovní} ' +
      '(při shodě silnější; bez zahraných rukou Vysoká karta).',
    flavor: 'Zítra jasno, místy Full house.',
  },
  sick_note: {
    name: 'Lékařské potvrzení',
    desc:
      'Když v příštím kole nedosáhneš cíle, ale máš aspoň {pct} % z něj, kolo se počítá jako vyhrané ' +
      '(bez odměny za útratu).',
    flavor: 'Neschopenka zpětně? Udělám výjimku.',
  },
  roadside_bazaar: {
    name: 'Bazar u silnice',
    desc: 'Dostaneš náhodného běžného žolíka; bez volného slotu místo něj {money|money}.',
    flavor: 'Starožitnosti, tašky a jeden žolík.',
  },
} satisfies TextTree;
