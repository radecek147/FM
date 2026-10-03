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
  fair_raffle: {
    name: 'Pouťová tombola',
    desc: 'Hlavní výhra: náhodný legendární žolík (potřebuje volný slot); jinak cena útěchy {money|money}.',
    flavor: 'Hlavní cena: legenda. Útěcha: sud piva a fotka s kolotočářem.',
    won: 'Tombola! Hlavní výhra jde k tobě.',
  },
  in_law_loan: {
    name: 'Půjčka od tchána',
    desc: 'Hned dostaneš {money|money}; po porážce šéfa tohoto patra se z odměny strhne {repay|money}.',
    flavor: 'Vrátíš, až budeš mít. Nejpozději v pátek. Ráno.',
  },
  paper_drive: {
    name: 'Sběr papíru',
    desc: 'Zničí z balíčku {cards|plural:kartu,karty,karet} s nejnižší hodnotou bez vylepšení, pečeti a edice a za každou dá {money|money}.',
    flavor: 'Za kilo starých karet razítko do žákovské. Za tři kila i pochvala.',
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
  harvest_festival: {
    name: 'Dožínky',
    desc: '+{levels|plural:úroveň,úrovně,úrovní} každé kombinaci, která se v tomto runu hrála aspoň {plays}× (když žádná, tvé nejhranější).',
    flavor: 'Věnec ze žita, tancovačka do rána a úroda bodů pro každého, kdo dřel.',
  },
  grandma_parcel: {
    name: 'Balík od babičky',
    desc: 'Hned otevřeš zdarma Tlustou obálku babských rad.',
    flavor: 'Buchty, ponožky a dobré rady.',
  },
  moving_day: {
    name: 'Stěhování',
    desc: '+{joker|plural:slot,sloty,slotů} žolíka, ale −{consumable|plural:slot,sloty,slotů} spotřebky do konce runu.',
    flavor: 'Skříň se do nového bytu nevešla. Žolík ano.',
  },
  mushroom_hunt: {
    name: 'Houbaření',
    desc: 'Přidá do balíčku {copies|plural:kopii,kopie,kopií} náhodné karty z balíčku (i s vylepšením, pečetí a edicí).',
    flavor: 'Kde roste jeden, rostou tři. Místo ti ale nikdo neprozradí.',
  },
  polished_cutlery: {
    name: 'Vyleštěné příbory',
    desc:
      'Příští žolík ve Večerce dostane náhodnou edici (lesklá {foil} %, holografická {holo} %, duhová {poly} %) ' +
      'bez příplatku.',
    flavor: 'Na návštěvu se vytahuje to nejlepší.',
  },
  hop_picking: {
    name: 'Brigáda na chmelu',
    desc: 'Další {rounds|plural:vyhrané kolo,vyhraná kola,vyhraných kol} dostaneš v odměnách navíc {money|money} (za každé).',
    flavor: 'Za dědy povinná, dnes aspoň placená. Výplata po žních.',
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
  mailbox_flyer: {
    name: 'Leták ve schránce',
    desc: 'V příští Večerce navíc {vouchers|plural:kupón,kupóny,kupónů}.',
    flavor: 'Na schránce je cedulka proti reklamě. Leták číst neumí.',
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
