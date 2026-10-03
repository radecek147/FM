/**
 * Texty grafiky a popisků obsahu (src/ui/art, src/ui/describe.ts, src/ui/components, src/ui/screens/gallery.ts):
 * názvy hracích karet („srdcová dáma“), vzácnosti, typy spotřebek, nálepky, tooltipy a vývojářská galerie.
 * Klíče `art.*`. Tvary názvů karet viz docs/DECISIONS.md („Figury, indexy a barvy karet“): v běžném textu malými.
 */

export const art = {
  /** Název hrací karty: přídavné jméno barvy ve správném rodě + hodnota (`srdcová dáma`, `pikové eso`). */
  cardName: {
    pattern: '{suit} {rank}',
    /** Hodnoty v 1. pádě malými (podle `Rank` 2–14). */
    rank: {
      2: 'dvojka',
      3: 'trojka',
      4: 'čtyřka',
      5: 'pětka',
      6: 'šestka',
      7: 'sedmička',
      8: 'osmička',
      9: 'devítka',
      10: 'desítka',
      11: 'kluk',
      12: 'dáma',
      13: 'král',
      14: 'eso',
    },
    /** Rod hodnoty (`f` ženský, `m` mužský, `n` střední) — určuje tvar přídavného jména barvy. */
    gender: {
      2: 'f',
      3: 'f',
      4: 'f',
      5: 'f',
      6: 'f',
      7: 'f',
      8: 'f',
      9: 'f',
      10: 'f',
      11: 'm',
      12: 'f',
      13: 'm',
      14: 'n',
    },
    /** Přídavné jméno barvy podle rodu (podle `Suit`). */
    suit: {
      S: { f: 'piková', m: 'pikový', n: 'pikové' },
      H: { f: 'srdcová', m: 'srdcový', n: 'srdcové' },
      D: { f: 'kárová', m: 'kárový', n: 'kárové' },
      C: { f: 'křížová', m: 'křížový', n: 'křížové' },
    },
    stone: 'kamenná karta',
    faceDown: 'karta lícem dolů',
    back: 'rub karty',
  },

  /** Stavy a doplňky hrací karty (aria-label, tooltip). */
  card: {
    /** aria-label: název a seznam úprav (`srdcová dáma, Prémiová, Lesklá`). */
    withExtras: '{name}, {extras}',
    debuffed: 'mimo provoz',
    chips: '+{chips|plural:čip,čipy,čipů}',
    debuffedHint: 'Mimo provoz – nedává čipy ani žádné efekty.',
    faceDownHint: 'Lícem dolů – otočí se, až ji zahraješ.',
    stoneHint: 'Nemá hodnotu ani barvu.',
  },

  /** Přístupné popisky karet obsahu (aria-label). */
  label: {
    joker: '{name} ({rarity})',
    consumable: '{name} ({kind})',
    content: '{name} ({kind})',
    withExtras: '{label}, {extras}',
    price: 'cena {price|money}',
    perishLeft: 'zvětrá za {n|plural:kolo,kola,kol}',
  },

  /** Vzácnosti žolíků (`JokerRarity`). */
  rarity: {
    common: 'Běžný',
    rare: 'Vzácný',
    epic: 'Epický',
    legendary: 'Legendární',
  },

  /** Typy spotřebek (`ConsumableKind`). */
  consumableKind: {
    pranostika: 'Pranostika',
    rada: 'Babská rada',
    razitko: 'Úřední razítko',
  },

  /** Druhy obsahu (podtitulek tooltipu, galerie). */
  kind: {
    card: 'Hrací karta',
    joker: 'Žolík',
    consumable: 'Spotřebka',
    voucher: 'Kupón',
    tag: 'Štítek',
    booster: 'Obálka',
    boss: 'Šéf',
    blind: 'Útrata',
    deck: 'Balíček',
    stake: 'Síla piva',
    challenge: 'Výzva',
    enhancement: 'Vylepšení',
    seal: 'Pečeť',
    edition: 'Edice',
    hand: 'Kombinace',
  },

  /** Útraty (`BlindKind`) — názvy pro žetony a popisky. */
  blind: {
    small: 'Malá útrata',
    big: 'Velká útrata',
    boss: 'Šéf',
  },

  /** Obálky (boostery): název z velikosti a druhu, pokud obálka nemá vlastní text v `boosters.<id>`. */
  booster: {
    name: '{size} · {kind}',
    // Bez předložky před číslem („1 ze 3“, ale „1 z 5“) — stejně jako popisky v boosters.ts.
    desc: 'Nabídne {options}, vybereš {picks}.',
    size: { normal: 'Obálka', jumbo: 'Tlustá obálka', mega: 'Krabice od bot' },
    kind: {
      pranostika: 'Pranostiky',
      rada: 'Babské rady',
      razitko: 'Razítka',
      joker: 'Žolíci',
      card: 'Hrací karty',
    },
  },

  /** Kupóny: úroveň v páru. */
  voucher: {
    tier1: 'Základní kupón',
    tier2: 'Vylepšený kupón',
    requires: 'Vyžaduje kupón {name}.',
  },

  /** Nálepky obtížností na žolících (`StickerId`, DESIGN 4.6). */
  stickers: {
    eternal: { name: 'Přibitý', desc: 'Nejde prodat ani zničit.' },
    perishable: {
      name: 'Zvětrávající',
      desc: 'Po {rounds|plural:kole,kolech,kolech} ve slotu zvětrá a přestane fungovat.',
      left: 'Zvětrá za {n|plural:kolo,kola,kol}.',
      perished: 'Zvětralý – nefunguje on ani jeho edice.',
    },
    rental: {
      name: 'Na splátky',
      desc: 'Na konci kola splátka {fee|money}, zbývá {n|plural:splátka,splátky,splátek}; pak je žolík tvůj. Bez peněz na splátku propadne.',
    },
  },

  /** Kopírující žolíci (`hooks.copyTarget`, např. Napodobitel): stav v tooltipu, detailu, Info o runu a v řadě. */
  copy: {
    active: 'Teď kopíruje: {name}.',
    idle: 'Koho bude kopírovat, si vybere na začátku kola.',
    none: 'V tomto kole nemá koho kopírovat.',
    copiedBy: 'Právě ho kopíruje: {names}.',
    notCopyable: 'Nejde zkopírovat – napodobitelé na něj nemají.',
    /** Doplněk aria-label karty v řadě. */
    labelActive: 'kopíruje: {name}',
    labelCopied: 'kopíruje ho {names}',
  },

  /** Tooltip (bublina s detailem). */
  tooltip: {
    flavor: '„{text}“',
    price: 'Cena {price|money}',
    sell: 'Prodej za {price|money}',
    edition: '{name}: {desc}',
    level: 'úroveň {level}',
    jokerDebuffed: 'Mimo provoz – v tomto kole nefunguje.',
    /** Proč je karta / žolík mimo provoz nebo lícem dolů (pravidlo šéfa, který právě platí). */
    bossReason: 'Šéf {name}: {rule}',
    noSell: 'Prodat nejde',
  },

  /** Slova, za kterými tooltip zvýrazní číslo barvou (čipy modře, mult červeně), oddělená čárkou. */
  highlight: {
    chips: 'čip,čipy,čipů',
    mult: 'mult',
  },

  /** Vývojářská galerie grafiky (`#gallery`). */
  gallery: {
    title: 'Galerie grafiky',
    intro:
      'Vývojářský přehled všech karet a obrázků. Najeď myší, přejdi Tabem nebo podrž prst a ukáže se detail.',
    back: 'Zpět do menu',
    loading: 'Načítám ikony…',
    empty: 'Zatím prázdné – obsah přibude v dalších fázích. Níž jsou ukázky.',
    sample: 'Ukázka {n}',
    sampleDesc: 'Ukázkový obrázek ({kind}) – skutečný obsah zatím chybí.',
    sections: {
      classic: 'Hrací karty – klasické barvy',
      colorblind: 'Hrací karty – čtyři barvy (barvoslepý režim)',
      enhancements: 'Vylepšení',
      seals: 'Pečetě',
      editions: 'Edice',
      states: 'Stavy karet',
      sizes: 'Velikosti',
      jokers: 'Žolíci',
      rarities: 'Rámečky vzácností',
      consumables: 'Spotřebky',
      vouchers: 'Kupóny',
      tags: 'Štítky',
      boosters: 'Obálky',
      bosses: 'Šéfové a útraty',
      decks: 'Balíčky',
      stakes: 'Síla piva',
      challenges: 'Výzvy',
    },
    states: {
      normal: 'Běžná',
      selected: 'Vybraná',
      debuffed: 'Mimo provoz',
      faceDown: 'Lícem dolů',
      back: 'Rub',
    },
  },
};
