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
  tourist: {
    name: 'Turistický',
    desc: 'Postupka i Barva stačí ze {cards} karet. Cíle všech útrat jsou ale {target|x}.',
    flavor: 'Po červené, pak po modré, pak se ztratit.',
  },
  marias: {
    name: 'Mariášový',
    desc: '{cards} karet: sedmičky až esa ve čtyřech barvách, bez dvojek až šestek. Postupka A-2-3-4-5 tu nejde.',
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
    desc: 'Odměny za útraty a úrok {reward|x}, každá nevyužitá ruka dává o {hand|money} víc. Zato o {hands|plural:ruku,ruce,rukou} méně v každém kole.',
    flavor: 'Peníze jsou, čas není.',
  },
  debtor: {
    name: 'Dlužník',
    desc: 'Start s {money|money}, dluh smí jít až {debt|money} pod nulu. Úrok {interest|x}, ale jen z kladného zůstatku.',
    flavor: 'Půjčka? Já? Jen na chvilku.',
  },
};
