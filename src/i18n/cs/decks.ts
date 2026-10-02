/**
 * Startovní balíčky (docs/DESIGN.md kap. 9) — klíče `decks.<id>.name|desc|flavor` podle id v src/content/decks.ts.
 * `{param}` dosadí UI z `params` definice.
 */
export const decks = {
  pub: {
    name: 'Hospodský',
    desc: 'Standardních {cards} karet, pravidla beze změny.',
    flavor: 'Lepkavé karty a tácek pod sklenicí.',
  },
  regulars: {
    name: 'Štamgastův',
    desc: '+{slots|plural:slot,sloty,slotů} pro žolíky, ale start jen s {money|money}.',
    flavor: 'Má tu vlastní věšák. Na žolíky.',
  },
  clerk: {
    name: 'Úřednický',
    // Názvy kupónů musí odpovídat `vouchers.tear_calendar|counter_buddy.name` (hlídá tests/unit/decks.test.ts).
    desc: 'Start s kupóny Trhací kalendář a Kamarád za pultem.',
    flavor: 'Všechno vyřízeno předem. Na razítko.',
  },
  tourist: {
    name: 'Turistický',
    desc: 'Postupka i Barva stačí ze {cards} karet. Cíle všech útrat jsou ale {target|x}.',
    flavor: 'Po červené, pak po modré, pak se ztratit.',
  },
  marias: {
    name: 'Mariášový',
    // \u2060 (word joiner) za spojovníky: „A-2-3-4-5“ se v popisku balíčku nezalomí na konci řádku.
    desc: '{cards} karet: sedmičky až esa ve čtyřech barvách, bez dvojek až šestek. Postupka A-\u20602-\u20603-\u20604-\u20605 tu nejde a cíle všech útrat jsou {target|x}.',
    flavor: 'Kdo nehraje, nevyhraje. Kdo hraje, flekuje.',
  },
  court: {
    name: 'Obrázkový',
    desc: '{cards} karet: kluci, dámy, králové a esa ve čtyřech barvách, každá karta {copies}×. V ruce o {hand|plural:kartu,karty,karet} méně a cíle {target|x}.',
    flavor: 'Samí páni, žádní pěšáci.',
  },
  notary: {
    name: 'Notářský',
    desc: 'Každá karta má na začátku runu {chance}% šanci na náhodnou pečeť. Spotřebky mají o {slots|plural:slot,sloty,slotů} méně.',
    flavor: 'Ověřeno, orazítkováno, zaplombováno.',
  },
  nouveau_riche: {
    name: 'Zbohatlík',
    desc: 'Odměny za útraty {reward|x} a úrok {interest|x}, každá nevyužitá ruka dává o {hand|money} víc. Zato o {hands|plural:ruku,ruce,rukou} méně v každém kole.',
    flavor: 'Peníze jsou, čas není.',
  },
  debtor: {
    name: 'Dlužník',
    desc: 'Start s {money|money}, dluh smí jít až {debt|money} pod nulu. Úrok {interest|x}, ale jen z kladného zůstatku.',
    flavor: 'Půjčka? Já? Jen na chvilku.',
  },
  grandmas: {
    name: 'Babiččin',
    desc: 'Spotřebky mají o {slots|plural:slot,sloty,slotů} víc. Na startu dostaneš {rady|plural:náhodnou babskou radu,různé náhodné babské rady,různých náhodných babských rad}.',
    flavor: 'Babička ví všechno. A ráda to řekne.',
  },
  junk_shop: {
    name: 'Vetešnický',
    desc: 'Start s jedním náhodným vzácným žolíkem. Večerka má o {slots|plural:kartový slot,kartové sloty,kartových slotů} méně.',
    flavor: 'Všechno z druhé ruky, něco i ze třetí.',
  },
  almanac: {
    name: 'Kalendářový',
    desc: 'Po porážce každého šéfa vznikne pranostika tvé nejčastěji hrané kombinace (když není volný slot, dostaneš {money|money}). Zato o {discards|plural:zahození,zahození,zahození} méně v každém kole.',
    flavor: 'Pranostika na každý den, i na ty, kdy se nehraje.',
    made: 'Kalendář vytrhl list: máš novou pranostiku.',
    full: 'Na pranostiku není místo, kalendář ji vyplatil: {money|money}.',
  },
};
